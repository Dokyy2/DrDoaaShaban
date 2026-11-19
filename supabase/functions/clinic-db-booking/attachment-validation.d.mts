export type BookingAttachmentValidation =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; message: string };

export function validateBookingAttachment(
  payload: Record<string, unknown>,
): BookingAttachmentValidation;
