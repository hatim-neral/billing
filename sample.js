'use strict';

// Optional demo data: 100 made-up customers with a year of bills.
// Everything created here is tagged `sample: true` so it can be removed cleanly.

const SAMPLE_FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Kabir',
  'Rohan', 'Rahul', 'Imran', 'Faizan', 'Zaid', 'Yusuf', 'Hamza', 'Karan', 'Nikhil', 'Varun',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Myra', 'Sara', 'Zoya', 'Ayesha', 'Fatima', 'Priya',
  'Neha', 'Pooja', 'Riya', 'Sneha', 'Kavya', 'Meera', 'Nisha', 'Simran', 'Tanvi', 'Sana'];
const SAMPLE_LAST = ['Sharma', 'Verma', 'Patel', 'Shah', 'Khan', 'Shaikh', 'Mehta', 'Gupta', 'Singh', 'Reddy',
  'Iyer', 'Nair', 'Joshi', 'Kapoor', 'Malhotra', 'Ansari', 'Qureshi', 'Desai', 'Kulkarni', 'Bhatt'];

// [item name, min price, max price] per category
const SAMPLE_ITEMS = {
  'Watches': [['Titan Neo watch', 2500, 6000], ['Fastrack Reflex watch', 1500, 3500], ['Casio G-Shock watch', 6000, 12000],
    ['Fossil Grant watch', 8000, 14000], ['Cartier Tank watch', 10000, 25000], ['Timex Expedition watch', 3000, 7000]],
  'Sunglasses': [['Rayban Aviator sunglasses', 5000, 9000], ['Oakley Holbrook sunglasses', 6000, 10000],
    ['Fastrack wayfarer sunglasses', 800, 2000], ['Police sunglasses', 3500, 7000]],
  'Frames': [['Titan Eye+ frame', 1500, 4000], ['Vincent Chase frame', 1000, 2500], ['Rayban optical frame', 4000, 8000]],
  'T-Shirts': [['Nike t-shirt', 1200, 2500], ['Puma t-shirt', 900, 1800], ['Polo t-shirt', 500, 1500]],
  'Shirts': [['Peter England shirt', 1200, 2500], ['Allen Solly shirt', 1500, 3000], ['Linen shirt', 1000, 2200]],
  'Tracks': [['Adidas track pant', 1500, 3000], ['Nike joggers', 1800, 3500], ['Cotton track pant', 600, 1200]],
  'Jeans': [['Levis jeans', 2500, 4500], ['Wrangler jeans', 1800, 3500], ['Spykar denim jeans', 1500, 3000]],
};

function makeSampleData(startBillNo) {
  const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const pick = arr => arr[rand(0, arr.length - 1)];
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
  const price = (min, max) => Math.round(rand(min, max) / 50) * 50 - (Math.random() < 0.4 ? 1 : 0); // e.g. 2999
  const cats = Object.keys(SAMPLE_ITEMS);

  const customers = [];
  const bills = [];
  for (let i = 1; i <= 100; i++) {
    const id = uid() + i;
    customers.push({
      id,
      name: `${pick(SAMPLE_FIRST)} ${pick(SAMPLE_LAST)}`,
      phone: `90000 ${String(i).padStart(5, '0')}`,
      createdAt: Date.now(),
      sample: true,
    });

    for (let n = rand(1, 5); n > 0; n--) {
      // spread over the last ~14 months, gently weighted towards recent ones so sales trend upward;
      // the first few customers also bought something today
      let age = 0;
      if (!(i <= 3 && n === 1)) {
        do age = rand(0, 420); while (Math.random() > 1 - 0.45 * age / 420);
      }
      const items = [];
      for (let k = rand(1, 3); k > 0; k--) {
        const cat = pick(cats);
        const [name, min, max] = pick(SAMPLE_ITEMS[cat]);
        items.push({ category: cat, name, qty: 1, price: price(min, max) });
      }
      const subtotal = items.reduce((s, it) => s + it.price, 0);
      const discount = Math.random() < 0.2 ? Math.round(subtotal * 0.05 / 10) * 10 : 0;
      const total = subtotal - discount;
      const date = daysAgo(age);

      // ~70% paid on the spot, ~15% part-paid (some settled later), ~15% unpaid
      const r = Math.random();
      const payments = [];
      const mode = () => pick(['Cash', 'UPI', 'UPI', 'Card']);
      if (r < 0.7) {
        payments.push({ id: uid(), amount: total, date, mode: mode() });
      } else if (r < 0.85) {
        const first = Math.round(total * rand(30, 70) / 100);
        payments.push({ id: uid(), amount: first, date, mode: mode() });
        if (age > 20 && Math.random() < 0.5) {
          payments.push({ id: uid(), amount: total - first, date: daysAgo(age - rand(5, 20)), mode: mode() });
        }
      }
      bills.push({ id: uid() + i + 'b' + n, customerId: id, date, items, discount, note: '', payments, createdAt: Date.now(), sample: true });
    }
  }

  // number the bills in date order
  bills.sort((a, b) => a.date.localeCompare(b.date));
  bills.forEach((b, i) => { b.no = startBillNo + i; });
  return { customers, bills };
}
