import { createRelayServer } from '../relay-dist/relay.js';
const relay = createRelayServer({ origins: process.env.RELAY_ORIGINS?.split(',') });
const port = Number(process.env.RELAY_PORT || 8973);
relay.server.listen(port, process.env.RELAY_HOST || '127.0.0.1', () => console.info(`Ages Ago relay listening on ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void relay.close().then(() => process.exit(0)); });
