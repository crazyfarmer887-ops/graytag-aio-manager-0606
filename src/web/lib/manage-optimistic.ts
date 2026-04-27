type RecruitingProduct = { productUsid: string; [key: string]: unknown };

type ManageDataWithRecruiting<TProduct extends RecruitingProduct = RecruitingProduct> = {
  onSaleByKeepAcct: Record<string, TProduct[]>;
  [key: string]: unknown;
};

export function removeRecruitingProductFromManageData<TData extends ManageDataWithRecruiting>(
  data: TData,
  keepAcct: string,
  productUsid: string,
): TData {
  const current = data.onSaleByKeepAcct?.[keepAcct] || [];
  const nextForAccount = current.filter(product => String(product.productUsid) !== String(productUsid));

  return {
    ...data,
    onSaleByKeepAcct: {
      ...data.onSaleByKeepAcct,
      [keepAcct]: nextForAccount,
    },
  };
}
