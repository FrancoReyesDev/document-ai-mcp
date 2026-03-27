import type { Request, Response, NextFunction } from "express";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

/**
 * Middleware: validates X-Admin-Key header for admin/internal endpoints.
 */
export async function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = req.headers["x-admin-key"] as string | undefined;

  if (!ADMIN_SECRET) {
    res.status(500).json({ error: "Admin secret not configured" });
    return;
  }

  if (!key || key !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized: invalid admin key" });
    return;
  }

  next();
}
