import { seedLedger } from '../../ledger/src/data.ts';
import { readDefectSwitches } from '../../ledger/src/defects.ts';
import { createLedgerExpressApp } from './routes.ts';

const port = Number(process.env['PORT'] ?? 3001);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error(`PORT must be an integer between 0 and 65535, received "${process.env['PORT']}"`);
}

const defects = readDefectSwitches(process.env);
const app = createLedgerExpressApp({ data: seedLedger(), defects });

const server = app.listen(port, () => {
  const address = server.address();
  const bound = address !== null && typeof address !== 'string' ? address.port : port;
  const enabled = Object.entries(defects)
    .filter(([name, on]) => on && name !== 'd5UndeclaredDebugEndpoint')
    .map(([name]) => name);

  console.log(`ledger-express listening on http://127.0.0.1:${bound}`);
  console.log(`defects enabled: ${enabled.length > 0 ? enabled.join(', ') : 'none'}`);
});
