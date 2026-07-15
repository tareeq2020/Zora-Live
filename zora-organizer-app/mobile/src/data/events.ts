export interface ConsumerEvent {
  id: string;
  name: string;
  venue: string;
  date: string;
  from: string;       // display price
  cover: string;      // solid tint (swap for imagery / video thumb later)
}

export const events: ConsumerEvent[] = [
  { id: 'offshore', name: 'OFFSHORE', venue: 'Yacht · Dar', date: '25 Jul', from: 'TZS 65,000', cover: '#3D5AFE' },
  { id: 'kultur', name: 'KULTUR NIGHTS', venue: 'Nairobi', date: '15 Aug', from: 'KES 2,500', cover: '#FF5A1F' },
  { id: 'sundowner', name: 'SUNDOWNER 03', venue: 'Zanzibar', date: '24 Aug', from: 'TZS 40,000', cover: '#E9A83B' },
  { id: 'warehouse', name: 'WAREHOUSE', venue: 'Dar', date: '6 Sep', from: 'TZS 30,000', cover: '#17B368' },
  { id: 'jazz', name: 'RIVERSIDE JAZZ', venue: 'Dar', date: '12 Sep', from: 'TZS 55,000', cover: '#8a6bff' },
  { id: 'amapiano', name: 'AMAPIANO ALL DAY', venue: 'Dar', date: '20 Sep', from: 'TZS 45,000', cover: '#ff4f8b' },
];
