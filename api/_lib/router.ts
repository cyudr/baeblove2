import { Router, type Request, type Response } from 'express';
import healthHandler from '../health';
import massImportHandler from '../gemini/mass-import';
import type { ApiRequest, ApiResponse } from './gemini';

export function createApiRouter(): Router {
  const router = Router();

  router.all('/health', (req: Request, res: Response) => {
    void healthHandler(req as unknown as ApiRequest, res as unknown as ApiResponse);
  });

  router.all('/gemini/mass-import', (req: Request, res: Response) => {
    void massImportHandler(req as unknown as ApiRequest, res as unknown as ApiResponse);
  });

  router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  return router;
}
