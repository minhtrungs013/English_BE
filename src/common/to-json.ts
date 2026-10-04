import type { ToObjectOptions } from 'mongoose';

/** Dates become epoch milliseconds so the frontend can use them as numbers. */
function datesToMs(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.map(datesToMs);
  if (v && typeof v === 'object' && v.constructor === Object) {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = datesToMs(o[k]);
  }
  return v;
}

/**
 * Shared toJSON options: expose `id` instead of `_id`, hide internal fields
 * (owner, anything ending in `Lower`, `__v`, timestamps) and serialize dates as ms.
 */
export const jsonOptions: ToObjectOptions = {
  virtuals: false,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    if (ret._id) ret.id = String(ret._id);
    delete ret._id;
    delete ret.createdAt;
    delete ret.updatedAt;
    delete ret.user;
    for (const k of Object.keys(ret)) if (k.endsWith('Lower')) delete ret[k];
    return datesToMs(ret);
  }
};
