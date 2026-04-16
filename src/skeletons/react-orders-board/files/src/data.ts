export type OrderStatus = 'queued' | 'picking' | 'packed' | 'shipped';
export type OrderPriority = 'standard' | 'urgent';

export interface Order {
  id: string;
  customer: string;
  route: string;
  owner: string;
  total: number;
  status: OrderStatus;
  priority: OrderPriority;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderDraft {
  customer: string;
  route: string;
  owner: string;
  total: string;
  priority: OrderPriority;
  notes: string;
}

export interface StatusMeta {
  status: OrderStatus;
  label: string;
  hint: string;
}

export const statusFlow: OrderStatus[] = ['queued', 'picking', 'packed', 'shipped'];

export const statusMeta: StatusMeta[] = [
  { status: 'queued', label: 'Queued', hint: 'Ready for assignment' },
  { status: 'picking', label: 'Picking', hint: 'Warehouse in motion' },
  { status: 'packed', label: 'Packed', hint: 'Packed and awaiting pickup' },
  { status: 'shipped', label: 'Shipped', hint: 'On the road to the customer' },
];

export const statusLabels = Object.fromEntries(
  statusMeta.map((entry) => [entry.status, entry.label]),
) as Record<OrderStatus, string>;

export const statusHints = Object.fromEntries(
  statusMeta.map((entry) => [entry.status, entry.hint]),
) as Record<OrderStatus, string>;

export const initialOrders: Order[] = [
  {
    id: 'ord-2041',
    customer: 'Aster Home',
    route: 'Brooklyn dock',
    owner: 'Mina',
    total: 1840,
    status: 'queued',
    priority: 'urgent',
    notes: ['Invoice copy needed before handoff'],
    createdAt: '2026-04-12T09:10:00.000Z',
    updatedAt: '2026-04-12T10:15:00.000Z',
  },
  {
    id: 'ord-2042',
    customer: 'Northcut Labs',
    route: 'Warehouse east',
    owner: 'Jordan',
    total: 920,
    status: 'picking',
    priority: 'standard',
    notes: ['Bulk foam packaging requested'],
    createdAt: '2026-04-12T11:00:00.000Z',
    updatedAt: '2026-04-12T12:20:00.000Z',
  },
  {
    id: 'ord-2043',
    customer: 'Harbor Atelier',
    route: 'Queens loop',
    owner: 'Sol',
    total: 2560,
    status: 'packed',
    priority: 'urgent',
    notes: ['Fragile items with white-glove delivery'],
    createdAt: '2026-04-13T08:45:00.000Z',
    updatedAt: '2026-04-13T09:05:00.000Z',
  },
  {
    id: 'ord-2044',
    customer: 'Beacon Retail',
    route: 'Midtown express',
    owner: 'Lena',
    total: 640,
    status: 'queued',
    priority: 'standard',
    notes: ['Customer requested SMS on dispatch'],
    createdAt: '2026-04-13T13:30:00.000Z',
    updatedAt: '2026-04-13T14:10:00.000Z',
  },
  {
    id: 'ord-2045',
    customer: 'Clover Supply',
    route: 'Jersey hub',
    owner: 'Ravi',
    total: 3100,
    status: 'shipped',
    priority: 'urgent',
    notes: ['Delivered ahead of SLA'],
    createdAt: '2026-04-14T07:20:00.000Z',
    updatedAt: '2026-04-14T16:40:00.000Z',
  },
];

export const initialDraft: OrderDraft = {
  customer: '',
  route: '',
  owner: '',
  total: '',
  priority: 'standard',
  notes: '',
};
