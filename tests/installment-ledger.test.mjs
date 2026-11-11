import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
function fixture() {
 const db=new DatabaseSync(':memory:');
 db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE orders(id TEXT PRIMARY KEY,customer_email TEXT,total_amount_minor INTEGER,currency TEXT,payment_provider TEXT,payment_environment TEXT,status TEXT);
 INSERT INTO orders VALUES('booking','buyer@example.test',320000,'GHS','seevplus','sandbox','payment_pending');`);
 db.exec(readFileSync(new URL('../drizzle/0072_installment_ledger.sql',import.meta.url),'utf8'));
 db.exec(`INSERT INTO installment_plans VALUES('booking','buyer@example.test','seevplus','sandbox','{}','GHS',320000,100000,'now')`);
 const start=(id,amount)=>db.prepare(`INSERT INTO installment_charges(id,order_id,idempotency_hash,request_hash,amount_minor,state,created_at) VALUES(?,'booking',?,'request',?,'pending','now')`).run(id,id,amount);
 const settle=(id)=>db.prepare(`UPDATE installment_charges SET state='confirmed',provider_reference=?,provider_transaction_id=?,confirmed_at='now' WHERE id=?`).run('PAY-'+id,'TX-'+id,id);
 return {db,start,settle};
}
test('1000 + 1000 + 1000 + 200 preserved against one booking',()=>{
 const {db,start,settle}=fixture();
 for(const [i,amount] of [100000,100000,100000,20000].entries()){start(String(i),amount);settle(String(i));}
 assert.equal(db.prepare(`SELECT SUM(amount_minor) AS total FROM installment_charges WHERE state='confirmed'`).get().total,320000);
 assert.throws(()=>start('extra',1),/remaining balance/);
 settle('3'); // repeat confirmation has no duplicate credit
 assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM installment_charges`).get().n,4);
 db.close();
});
test('blocks concurrent unresolved payments and keeps timeout unresolved',()=>{
 const {db,start,settle}=fixture();start('a',100000);
 assert.throws(()=>start('b',100000),/UNIQUE/);
 db.exec(`UPDATE installment_charges SET state='review' WHERE id='a'`);
 assert.throws(()=>start('b',100000),/UNIQUE/);
 settle('a');start('b',220000);settle('b');db.close();
});
test('immutable money and buyer; provider identity and terminal state guarded',()=>{
 const {db,start,settle}=fixture(); start('a',100000);
 assert.throws(()=>db.exec(`UPDATE installment_plans SET buyer_email='other@example.test'`),/immutable/);
 assert.throws(()=>db.exec(`UPDATE installment_charges SET amount_minor=200000`),/immutable/);
 assert.throws(()=>db.exec(`UPDATE installment_charges SET state='confirmed'`),/identity required/);
 settle('a');assert.throws(()=>db.exec(`UPDATE installment_charges SET state='pending'`),/terminal/);
 assert.throws(()=>db.exec(`DELETE FROM installment_charges`),/cannot be deleted/);db.close();
});
test('provider reference and transaction cannot credit two installments',()=>{
 const {db,start,settle}=fixture();start('a',100000);settle('a');start('b',100000);
 assert.throws(()=>db.exec(`UPDATE installment_charges SET provider_reference='PAY-a' WHERE id='b'`),/UNIQUE/);
 assert.throws(()=>db.exec(`UPDATE installment_charges SET provider_transaction_id='TX-a' WHERE id='b'`),/UNIQUE/);db.close();
});
