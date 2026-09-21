export interface CampaignReportField {
  label: string;
  value: string;
}

export interface CampaignReport {
  title: string;
  subtitle: string;
  fields: CampaignReportField[];
  columns: { label: string; width: number }[];
  rows: string[][];
  pageLabel: string;
}

export const CAMPAIGN_REPORT_PAGE_SIZE = 6;

export function campaignReportPages(report: CampaignReport): CampaignReport[] {
  const pages = Math.max(
    1,
    Math.ceil(report.rows.length / CAMPAIGN_REPORT_PAGE_SIZE),
  );
  return Array.from({ length: pages }, (_, page) => ({
    ...report,
    subtitle:
      pages > 1
        ? `${report.subtitle} | ${report.pageLabel} ${page + 1}/${pages}`
        : report.subtitle,
    rows: report.rows.slice(
      page * CAMPAIGN_REPORT_PAGE_SIZE,
      (page + 1) * CAMPAIGN_REPORT_PAGE_SIZE,
    ),
  }));
}
