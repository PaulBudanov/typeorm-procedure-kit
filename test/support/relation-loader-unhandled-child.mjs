import { createServer } from 'vite';

let unhandledReason;
const onUnhandledRejection = (reason) => {
  unhandledReason = reason;
};
process.on('unhandledRejection', onUnhandledRejection);

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { RelationLoader } = await server.ssrLoadModule(
    '/src/typeorm/query-builder/RelationLoader.ts'
  );
  const loader = new RelationLoader({});
  loader.load = () => Promise.reject(new Error('lazy relation failed'));
  const entity = {};
  loader.enableLazyLoad(
    {
      propertyName: 'children',
      isManyToOne: false,
      isOneToOne: false,
    },
    entity
  );

  const originalPromise = entity.children;
  originalPromise.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 50));
} finally {
  process.off('unhandledRejection', onUnhandledRejection);
  await server.close();
}

if (unhandledReason !== undefined) {
  console.error(unhandledReason);
  process.exitCode = 1;
}
