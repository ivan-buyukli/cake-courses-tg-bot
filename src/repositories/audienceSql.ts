// The expression and alias are internal SQL fragments, never callback or user input.
export function audienceSql(contentExpression: string, alias = "u"): string {
  return `(CASE COALESCE(json_extract(${contentExpression}, '$.audience'), 'non_purchasers')
    WHEN 'non_purchasers' THEN ${alias}.payment_status != 'paid'
    WHEN 'unpaid' THEN ${alias}.payment_status = 'unpaid'
    WHEN 'unknown' THEN ${alias}.payment_status = 'unknown'
    WHEN 'pending' THEN ${alias}.payment_status = 'pending'
    ELSE 0 END)`;
}
