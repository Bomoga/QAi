import { createLedgerServer } from './app.ts';
import { seedLedger } from './data.ts';
import { readDefectSwitches } from './defects.ts';

const port = Number(process.env['PORT'] ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error(`PORT must be an integer between 0 and 65535, received "${process.env['PORT']}"`);
}

const defects = readDefectSwitches(process.env);
const server = createLedgerServer({ data: seedLedger(), defects });

server.listen(port, () => {
  const address = server.address();
  const bound = address !== null && typeof address !== 'string' ? address.port : port;
  const enabled = Object.entries(defects)
    .filter(([, on]) => on)
    .map(([name]) => name);

  console.log(`ledger listening on http://127.0.0.1:${bound}`);
  console.log(`defects enabled: ${enabled.length > 0 ? enabled.join(', ') : 'none'}`);
});
