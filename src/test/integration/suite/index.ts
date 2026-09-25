import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 120_000 });
  const suite = process.env.WTT_SUITE ?? 'extension';
  for (const file of fs.readdirSync(__dirname)) {
    if (file === `${suite}.test.js`) {
      mocha.addFile(path.resolve(__dirname, file));
    }
  }
  return new Promise((resolve, reject) => {
    mocha.run(failures => (failures ? reject(new Error(`${failures} tests failed.`)) : resolve()));
  });
}
