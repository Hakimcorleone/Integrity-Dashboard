import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../types";
import { calculateSlaDueAt, nextCaseId } from "../db";
import { notify } from "../notifications";
import {
  enforcePublicRateLimit,
  hmac,
  publicReference,
  sha256,
  trackingToken,
  validateFileSignature,
  validateUpload,
  verifyTurnstile,
} from "../security";
import { publicComplaintSchema } from "../validation";

interface PreparedUpload {
  id: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  checksum: string;
  buffer: ArrayBuffer;
}

export const publicApi = new Hono<AppBindings>();

publicApi.get("/config", async (context) => {
  const categories = await context.env.DB.prepare(
    "SELECT id, code, name FROM complaint_categories WHERE active = 1 ORDER BY name",
  ).all<{ id: string; code: string; name: string }>();
  return context.json({
    data: {
      appName: context.env.APP_NAME,
      turnstileSiteKey: context.env.TURNSTILE_SITE_KEY,
      categories: categories.results,
      maxUploadBytes: Number(context.env.MAX_UPLOAD_BYTES),
      acceptedFileTypes: [".pdf", ".jpg", ".jpeg", ".png", ".txt", ".docx", ".xlsx"],
    },
    correlationId: context.get("correlationId"),
  });
});

publicApi.post("/complaints", async (context) => {
  const remoteIp = context.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await enforcePublicRateLimit(context.env.DB, remoteIp, context.env.RATE_LIMIT_SALT))) {
    return context.json({ error: "Too many submissions. Please wait before trying again.", correlationId: context.get("correlationId") }, 429);
  }

  const form = await context.req.formData();
  const raw: Record<string, FormDataEntryValue | null> = {};
  for (const key of [
    "complainantType", "fullName", "email", "telephone", "organisation", "preferredCommunication",
    "categoryId", "title", "description", "incidentDate", "location", "department", "project",
    "subjectDetails", "financialImpact", "confidentialityAcknowledged", "declarationAccurate", "privacyConsent",
    "turnstileToken",
  ]) raw[key] = form.get(key);
  const parsed = publicComplaintSchema.safeParse(raw);
  if (!parsed.success) {
    return context.json({ error: "Submission validation failed.", details: z.flattenError(parsed.error).fieldErrors, correlationId: context.get("correlationId") }, 400);
  }
  if (!(await verifyTurnstile(parsed.data.turnstileToken, context.env.TURNSTILE_SECRET_KEY, remoteIp))) {
    return context.json({ error: "Human verification failed. Please refresh and try again.", correlationId: context.get("correlationId") }, 400);
  }

  const category = await context.env.DB.prepare(
    "SELECT id, default_confidentiality FROM complaint_categories WHERE id = ? AND active = 1",
  ).bind(parsed.data.categoryId).first<{ id: string; default_confidentiality: string }>();
  if (!category) return context.json({ error: "Invalid complaint category.", correlationId: context.get("correlationId") }, 400);

  const complaintId = crypto.randomUUID();
  const caseId = await nextCaseId(context.env.DB);
  const complaintReference = publicReference();
  const secretToken = trackingToken();
  const tokenHash = await sha256(secretToken);
  const ipHash = await hmac(remoteIp, context.env.RATE_LIMIT_SALT);
  const slaDueAt = await calculateSlaDueAt(context.env.DB, "Medium", category.id);
  const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > 5) return context.json({ error: "A maximum of five files may be attached.", correlationId: context.get("correlationId") }, 400);

  const preparedUploads: PreparedUpload[] = [];
  for (const file of files) {
    const result = validateUpload(file, Number(context.env.MAX_UPLOAD_BYTES));
    if (!result.ok) return context.json({ error: `${file.name}: ${result.reason}`, correlationId: context.get("correlationId") }, 400);
    const buffer = await file.arrayBuffer();
    if (!validateFileSignature(buffer, file.type)) {
      return context.json({ error: `${file.name}: File content does not match its declared type.`, correlationId: context.get("correlationId") }, 400);
    }
    preparedUploads.push({
      id: crypto.randomUUID(),
      key: `public-submissions/${complaintId}/${crypto.randomUUID()}`,
      filename: result.filename,
      contentType: file.type,
      size: file.size,
      checksum: await sha256(buffer),
      buffer,
    });
  }

  const storedKeys: string[] = [];
  try {
    for (const upload of preparedUploads) {
      await context.env.EVIDENCE.put(upload.key, upload.buffer, {
        httpMetadata: { contentType: upload.contentType },
        customMetadata: { originalFilename: upload.filename, complaintId, source: "PUBLIC_SUBMISSION" },
      });
      storedKeys.push(upload.key);
    }

    const now = new Date().toISOString();
    const statements = [
      context.env.DB.prepare(
        `INSERT INTO complaints
          (id, case_id, complaint_reference, tracking_token_hash, complainant_type, category_id, title, summary,
           full_description, incident_date, location, project, department, subject_details, estimated_financial_impact,
           confidentiality, risk_rating, risk_score, status, public_status, sla_due_at, acknowledged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Medium', 20, 'Preliminary Assessment', 'Received', ?, ?)`,
      ).bind(
        complaintId, caseId, complaintReference, tokenHash, parsed.data.complainantType, category.id, parsed.data.title,
        parsed.data.description.slice(0, 500), parsed.data.description, parsed.data.incidentDate || null,
        parsed.data.location || null, parsed.data.project || null, parsed.data.department || null,
        parsed.data.subjectDetails || null, parsed.data.financialImpact, category.default_confidentiality, slaDueAt, now,
      ),
      context.env.DB.prepare(
        `INSERT INTO complainants
          (id, complaint_id, full_name, email, telephone, organisation, preferred_communication,
           privacy_consent_at, confidentiality_acknowledged_at, declaration_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), complaintId,
        parsed.data.complainantType === "Anonymous" ? null : parsed.data.fullName || null,
        parsed.data.complainantType === "Anonymous" ? null : parsed.data.email || null,
        parsed.data.complainantType === "Anonymous" ? null : parsed.data.telephone || null,
        parsed.data.organisation || null, parsed.data.preferredCommunication, now, now, now,
      ),
      context.env.DB.prepare(
        "INSERT INTO status_history (id, complaint_id, from_status, to_status, reason) VALUES (?, ?, NULL, 'New', 'Public complaint submitted')",
      ).bind(crypto.randomUUID(), complaintId),
      context.env.DB.prepare(
        "INSERT INTO status_history (id, complaint_id, from_status, to_status, reason) VALUES (?, ?, 'New', 'Acknowledged', 'Submission confirmation issued')",
      ).bind(crypto.randomUUID(), complaintId),
      context.env.DB.prepare(
        "INSERT INTO status_history (id, complaint_id, from_status, to_status, reason) VALUES (?, ?, 'Acknowledged', 'Preliminary Assessment', 'Queued for Integrity assessment')",
      ).bind(crypto.randomUUID(), complaintId),
      context.env.DB.prepare(
        `INSERT INTO communications (id, complaint_id, communication_type, direction, channel, recipient, subject, summary, status, completed_at)
         VALUES (?, ?, 'ACKNOWLEDGEMENT', 'OUTBOUND', ?, ?, 'Complaint received', 'Submission acknowledgement issued without investigation details.', 'COMPLETED', ?)`,
      ).bind(crypto.randomUUID(), complaintId, parsed.data.email ? "Email" : "Portal", parsed.data.email || null, now),
      context.env.DB.prepare(
        `INSERT INTO audit_logs
          (id, action, entity_type, entity_id, new_value, correlation_id, ip_hash, reason, source)
         VALUES (?, 'COMPLAINT_CREATED', 'complaint', ?, ?, ?, ?, 'Public submission', 'PUBLIC')`,
      ).bind(
        crypto.randomUUID(), complaintId,
        JSON.stringify({ caseId, complaintReference, complainantType: parsed.data.complainantType, categoryId: category.id }),
        context.get("correlationId"), ipHash,
      ),
      ...preparedUploads.map((upload) => context.env.DB.prepare(
        `INSERT INTO attachments
          (id, complaint_id, object_key, original_filename, content_type, file_size, checksum_sha256, classification, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PUBLIC_SUBMISSION')`,
      ).bind(upload.id, complaintId, upload.key, upload.filename, upload.contentType, upload.size, upload.checksum, category.default_confidentiality)),
      ...preparedUploads.map((upload) => context.env.DB.prepare(
        `INSERT INTO audit_logs
          (id, action, entity_type, entity_id, new_value, correlation_id, reason, source)
         VALUES (?, 'EVIDENCE_UPLOADED', 'attachment', ?, ?, ?, 'Public supporting document', 'PUBLIC')`,
      ).bind(
        crypto.randomUUID(), upload.id,
        JSON.stringify({ complaintId, originalFilename: upload.filename, fileSize: upload.size, checksum: upload.checksum }),
        context.get("correlationId"),
      )),
    ];
    if (parsed.data.subjectDetails) {
      statements.push(context.env.DB.prepare(
        "INSERT INTO complaint_subjects (id, complaint_id, name_or_description) VALUES (?, ?, ?)",
      ).bind(crypto.randomUUID(), complaintId, parsed.data.subjectDetails));
    }
    await context.env.DB.batch(statements);
  } catch (error) {
    await Promise.allSettled(storedKeys.map((key) => context.env.EVIDENCE.delete(key)));
    throw error;
  }

  await notify(context.env, {
    eventType: "COMPLAINT_RECEIVED",
    complaintId,
    subject: `New complaint ${caseId}`,
    body: `A new complaint is awaiting preliminary assessment. Open it only in the protected portal.`,
    actionUrl: `/portal/cases/${encodeURIComponent(caseId)}`,
    idempotencyKey: `complaint-received:${complaintId}`,
  });
  if (parsed.data.email && parsed.data.complainantType !== "Anonymous") {
    await notify(context.env, {
      eventType: "COMPLAINT_ACKNOWLEDGEMENT",
      complaintId,
      recipientEmail: parsed.data.email,
      subject: `Complaint received: ${complaintReference}`,
      body: `Your complaint has been received. Reference: ${complaintReference}. Keep the secure tracking token shown at submission; it will not be sent by email.`,
      idempotencyKey: `complaint-ack:${complaintId}`,
    });
  }

  return context.json({
    data: { reference: complaintReference, trackingToken: secretToken, status: "Received" },
    correlationId: context.get("correlationId"),
  }, 201);
});

publicApi.post("/track", async (context) => {
  const remoteIp = context.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await enforcePublicRateLimit(context.env.DB, remoteIp, context.env.RATE_LIMIT_SALT))) {
    return context.json({ error: "Too many tracking attempts. Please wait before trying again.", correlationId: context.get("correlationId") }, 429);
  }
  const schema = z.object({ reference: z.string().trim().min(10).max(40), trackingToken: z.string().min(20).max(100) });
  const parsed = schema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: "Reference and tracking token are required.", correlationId: context.get("correlationId") }, 400);
  const tokenHash = await sha256(parsed.data.trackingToken);
  const complaint = await context.env.DB.prepare(
    `SELECT public_status, updated_at FROM complaints
     WHERE complaint_reference = ? AND tracking_token_hash = ? AND deleted_at IS NULL`,
  ).bind(parsed.data.reference.toUpperCase(), tokenHash).first<{ public_status: string; updated_at: string }>();
  if (!complaint) return context.json({ error: "Tracking details were not recognised.", correlationId: context.get("correlationId") }, 404);
  return context.json({ data: { status: complaint.public_status, lastUpdated: complaint.updated_at }, correlationId: context.get("correlationId") });
});
