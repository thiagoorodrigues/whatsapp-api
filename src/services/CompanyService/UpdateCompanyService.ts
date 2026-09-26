import moment from "moment";
import AppError from "../../errors/AppError";
import Company from "../../models/Company";

interface CompanyData {
  name: string;
  id?: number | string;
  phone?: string;
  email?: string;
  status?: boolean;
  planId?: number;
  dueDate?: string;
  recurrence?: string;
}

// dueDate arrives as "YYYY-MM-DD" but the column is a timestamp (Date);
// compare by calendar day instead of by reference.
export const isSameDueDate = (
  sent: string | null | undefined,
  current: Date | string | null | undefined
): boolean => {
  if (!sent || !current) return !sent && !current;
  return moment(sent).isSame(moment(current), "day");
};

const UpdateCompanyService = async (
  companyData: CompanyData
): Promise<Company> => {
  const company = await Company.findByPk(companyData.id);
  const {
    name,
    phone,
    email,
    status,
    planId,
    dueDate,
    recurrence
  } = companyData;

  if (!company) {
    throw new AppError("ERR_NO_COMPANY_FOUND", 404);
  }

  // Verifique se a empresa é a Empresa 1 e se a data de validade está sendo alterada
  if (company.id === 1 && dueDate !== undefined && !isSameDueDate(dueDate, company.dueDate)) {
    throw new AppError("ERR_CANNOT_UPDATE_SUPER_COMPANY_DUE_DATE");
  }

  await company.update({
    name,
    phone,
    email,
    status,
    planId,
    dueDate,
    recurrence
  });

  return company;
};

export default UpdateCompanyService;
