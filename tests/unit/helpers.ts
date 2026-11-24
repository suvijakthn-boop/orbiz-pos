import { db, uid, type Product } from '../../src/lib/db';

export async function makeStaff(name = 'ฝน') {
  const id = uid();
  await db.staff.add({ id, name, active: true, createdAt: Date.now() });
  return id;
}

export async function makeProduct(p: Partial<Product> = {}): Promise<Product> {
  const prod: Product = {
    id: uid(),
    name: 'เวย์โปรตีน',
    categoryId: null,
    price: 12000,
    cost: 5000,
    stock: 10,
    trackStock: true,
    lowStock: 2,
    imageId: null,
    active: true,
    sort: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...p,
  };
  await db.products.add(prod);
  return prod;
}

export const slip = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
