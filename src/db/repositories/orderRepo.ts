import { pool } from '../client';

export async function insertOrder(order: any) {
  const q = `INSERT INTO orders(id, user_wallet, token_in, token_out, amount_in, slippage, status, retry_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`;
  await pool.query(q, [
    order.id,
    order.userWallet,
    order.tokenIn,
    order.tokenOut,
    order.amountIn,
    order.slippage || 0.01,
    order.status || 'pending',
    0,
  ]);
}

export async function updateOrderStatus(id: string, fields: any) {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;
  for (const k of Object.keys(fields)) {
    sets.push(`${k} = $${idx}`);
    vals.push(fields[k]);
    idx++;
  }
  vals.push(id);
  const q = `UPDATE orders SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idx}`;
  await pool.query(q, vals);
}

export async function getOrder(id: string) {
  const res = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
  return res.rows[0];
}
