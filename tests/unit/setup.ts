import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { PosDB, useDatabase } from '../../src/lib/db';

let n = 0;
beforeEach(() => {
  useDatabase(new PosDB(`test-${Date.now()}-${n++}`));
});
