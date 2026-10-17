import type { DemoCompany } from '../../shared/demo-companies.js';

interface CompanyLogoProps {
  company: DemoCompany;
}

export function CompanyLogo({ company }: CompanyLogoProps) {
  return <img className="company-logo" src={company.logoPath} alt="" draggable={false} />;
}
