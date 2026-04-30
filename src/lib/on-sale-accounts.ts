export interface OnSaleProductLike {
  productUsid?: string;
  productType?: string;
  productName?: string;
  price?: string;
  purePrice?: number;
  endDateTime?: string | null;
  remainderDays?: number;
  keepAcct?: string;
  keepPasswd?: string;
  keepMemo?: string;
}

export type OnSaleByKeepAcct = Record<string, OnSaleProductLike[]>;

const SERVICE_MAX_SLOTS: Record<string, number> = {
  '디즈니플러스': 6,
  '왓챠플레이': 4,
  '티빙': 4,
  '웨이브': 4,
  '넷플릭스': 5,
};

export function serviceMaxSlots(serviceType: string): number {
  return SERVICE_MAX_SLOTS[String(serviceType || '').trim()] || 6;
}

function managementAccountKey(serviceType: string, email: string): string {
  return `${String(serviceType || '').trim()}:${String(email || '').trim().toLowerCase()}`;
}

export function onSaleAccountToManagementAccount(serviceType: string, keepAcct: string, products: OnSaleProductLike[]) {
  const firstWithPassword = products.find(product => String(product.keepPasswd || '').trim());
  return {
    email: keepAcct,
    serviceType,
    members: [],
    usingCount: 0,
    activeCount: 0,
    totalSlots: serviceMaxSlots(serviceType),
    totalIncome: 0,
    totalRealizedIncome: 0,
    expiryDate: null,
    keepPasswd: firstWithPassword?.keepPasswd?.trim() || undefined,
    onSaleAccount: {
      productCount: products.length,
      source: 'graytag-on-sale',
    },
  };
}

export function mergeOnSaleAccountsIntoManagement<T extends {
  services: Array<{ serviceType: string; accounts: any[]; totalUsingMembers: number; totalActiveMembers: number; totalIncome: number; totalRealized: number }>;
  summary: { totalAccounts: number; [key: string]: unknown };
}>(management: T, onSaleByKeepAcct: OnSaleByKeepAcct): T {
  const next: T = {
    ...management,
    services: management.services.map(service => ({ ...service, accounts: [...service.accounts] })),
    summary: { ...management.summary },
  };

  const existing = new Map<string, any>();
  for (const service of next.services) {
    for (const account of service.accounts) {
      existing.set(managementAccountKey(account.serviceType || service.serviceType, account.email), account);
    }
  }

  let added = 0;
  for (const [rawKeepAcct, products] of Object.entries(onSaleByKeepAcct || {})) {
    const keepAcct = String(rawKeepAcct || '').trim();
    if (!keepAcct || keepAcct === '(직접전달)' || !Array.isArray(products) || products.length === 0) continue;
    const byService = new Map<string, OnSaleProductLike[]>();
    for (const product of products) {
      const serviceType = String(product.productType || '').trim() || '기타';
      if (!byService.has(serviceType)) byService.set(serviceType, []);
      byService.get(serviceType)!.push(product);
    }

    for (const [serviceType, serviceProducts] of Array.from(byService.entries())) {
      const key = managementAccountKey(serviceType, keepAcct);
      const existingAccount = existing.get(key);
      if (existingAccount) {
        existingAccount.onSaleAccount = {
          productCount: serviceProducts.length,
          source: 'graytag-on-sale',
        };
        const firstWithPassword = serviceProducts.find(product => String(product.keepPasswd || '').trim());
        if (!existingAccount.keepPasswd && firstWithPassword?.keepPasswd?.trim()) {
          existingAccount.keepPasswd = firstWithPassword.keepPasswd.trim();
        }
        continue;
      }
      let service = next.services.find(s => s.serviceType === serviceType);
      if (!service) {
        service = { serviceType, accounts: [], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 };
        next.services.push(service);
      }
      const account = onSaleAccountToManagementAccount(serviceType, keepAcct, serviceProducts);
      service.accounts.unshift(account);
      existing.set(key, account);
      added += 1;
    }
  }

  for (const service of next.services) {
    service.accounts.sort((a, b) => {
      const aRecruiting = a.onSaleAccount ? 1 : 0;
      const bRecruiting = b.onSaleAccount ? 1 : 0;
      return b.usingCount - a.usingCount || b.activeCount - a.activeCount || bRecruiting - aRecruiting;
    });
  }

  next.summary.totalAccounts = Number(next.summary.totalAccounts || 0) + added;
  return next;
}
