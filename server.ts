import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';

// Load local .env files if present without overriding runtime environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

function parseCliOption(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag && args[i + 1]) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

function resolvePort(): number {
  const cliPort = Number(parseCliOption('--port'));
  if (Number.isFinite(cliPort) && cliPort > 0) {
    return cliPort;
  }

  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  const isDev = process.env.NODE_ENV !== 'production';
  if (Number.isFinite(envPort) && envPort > 0 && !(isDev && envPort === nginxPort)) {
    return envPort;
  }

  const defaultPort = Number(process.env.DEFAULT_APP_PORT);
  return Number.isFinite(defaultPort) && defaultPort > 0 ? defaultPort : 3000;
}

const PORT = resolvePort();
const HOST = parseCliOption('--host') || '0.0.0.0';

let healthHandlerPromise: Promise<(req: Request, res: Response) => Promise<void>> | null = null;
let geminiHandlerPromise: Promise<(req: Request, res: Response) => Promise<void>> | null = null;

function getHealthHandler() {
  if (!healthHandlerPromise) {
    healthHandlerPromise = import('./api/health.ts').then((mod) => mod.default);
  }
  return healthHandlerPromise;
}

function getGeminiHandler() {
  if (!geminiHandlerPromise) {
    geminiHandlerPromise = import('./api/gemini.ts').then((mod) => mod.default);
  }
  return geminiHandlerPromise;
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Route all /api endpoints to standalone handlers in the root /api folder (loaded lazily for fast startup)
  app.all('/api/health', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const handler = await getHealthHandler();
      await handler(req, res);
    } catch (err) {
      next(err);
    }
  });
  app.all('/api/gemini', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const handler = await getGeminiHandler();
      await handler(req, res);
    } catch (err) {
      next(err);
    }
  });

  let closeVite: (() => Promise<void>) | null = null;

  if (process.env.NODE_ENV !== 'production') {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const viteReady = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          ...(disableHmr ? { hmr: false, ws: false, watch: null } : {}),
        },
        appType: 'spa',
      })
    );

    viteReady
      .then((vite) => {
        closeVite = () => vite.close();
      })
      .catch((err) => {
        console.error('Failed to initialize Vite middleware:', err);
        process.exit(1);
      });

    app.use((req: Request, res: Response, next: NextFunction) => {
      viteReady
        .then((vite) => vite.middlewares(req, res, next))
        .catch(next);
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => {
      if (closeVite) {
        void closeVite().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

createApp().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
