import { IndustryReport } from "@/types";

export const industryReports: IndustryReport[] = [
  {
    id: "1", title: "Nepal MFI Sector Performance Report Q4 2025/26", period: "Q4 2025/26", publishedAt: "2026-07-15", category: "Quarterly",
    summary: "Aggregate financial performance of 51 Class D MFIs for the fourth quarter of fiscal year 2025/26.",
    metrics: [
      { label: "Total Paid-Up Capital", value: "Rs 3,842 Cr", change: "+12.3%", trend: "up" },
      { label: "Average NPL Ratio", value: "2.85%", change: "-0.15pp", trend: "down" },
      { label: "Total Borrowers", value: "2.1M", change: "+8.7%", trend: "up" },
      { label: "Total Branches", value: "4,850", change: "+5.2%", trend: "up" },
    ]
  },
  {
    id: "2", title: "Merger Impact Analysis: Pre and Post-Merger Metrics", period: "FY 2025/26", publishedAt: "2026-06-30", category: "Special Report",
    summary: "Analysis of 15 merger transactions completed between 2023-2026 with pre and post-merger financial comparisons.",
    metrics: [
      { label: "Mergers Completed", value: "15", change: "+7 from FY24", trend: "up" },
      { label: "Post-Merger Capital Avg", value: "Rs 152 Cr", change: "+185%", trend: "up" },
      { label: "Post-Merger NPL Avg", value: "2.1%", change: "-1.2pp", trend: "down" },
      { label: "Institutions Reduced", value: "51 to 38", change: "-13", trend: "down" },
    ]
  },
  {
    id: "3", title: "Digital Finance Adoption Index 2026", period: "H1 2026", publishedAt: "2026-06-15", category: "Technology",
    summary: "Index measuring digital adoption across 51 MFIs including mobile banking, online applications, and digital payments.",
    metrics: [
      { label: "Digital Adoption Rate", value: "64%", change: "+18%", trend: "up" },
      { label: "MFIs with Mobile Apps", value: "22", change: "+6", trend: "up" },
      { label: "Digital Loan Origination", value: "38%", change: "+12%", trend: "up" },
      { label: "Rural Digital Access", value: "41%", change: "+9%", trend: "up" },
    ]
  },
  {
    id: "4", title: "Province-Level MFI Penetration Analysis", period: "2026", publishedAt: "2026-05-20", category: "Geographic",
    summary: "Geographic distribution analysis of MFI branches, borrowers, and loan penetration across Nepal's 7 provinces.",
    metrics: [
      { label: "Bagmati Share", value: "32%", change: "+2%", trend: "up" },
      { label: "Koshi Share", value: "18%", change: "0%", trend: "neutral" },
      { label: "Lowest Penetration", value: "Karnali 4%", change: "+0.5%", trend: "up" },
      { label: "Avg Branches/MFI", value: "95", change: "+8", trend: "up" },
    ]
  },
];

export const metricDefinitions = [
  { metric: "paid_up_capital", label: "Paid-Up Capital", unit: "Rs Cr", source: "NRB BFI List" },
  { metric: "npl_ratio", label: "NPL Ratio", unit: "%", source: "MFI Quarterly Reports" },
  { metric: "borrower_count", label: "Total Borrowers", unit: "Count", source: "MFI Annual Reports" },
  { metric: "branch_count", label: "Total Branches", unit: "Count", source: "MFI Annual Reports" },
  { metric: "operation_date", label: "Operation Date", unit: "Date", source: "NRB License Record" },
];
