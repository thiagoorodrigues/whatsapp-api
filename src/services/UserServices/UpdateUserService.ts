import * as Yup from "yup";

import AppError from "../../errors/AppError";
import ShowUserService from "./ShowUserService";
import Company from "../../models/Company";
import User from "../../models/User";
import { PROFILES, scopeUserLinks } from "./companyLinks";

interface UserData {
  email?: string;
  password?: string;
  name?: string;
  profile?: string;
  companyId?: number;
  queueIds?: number[];
  whatsappId?: number;
  status?: boolean;
  signMessage?: boolean;
}

interface Request {
  userData: UserData;
  userId: string | number;
  companyId: number;
  requestUserId: number;
}

interface Response {
  id: number;
  companyId: number;
  name: string;
  email: string;
  profile: string;
}

const UpdateUserService = async ({
  userData,
  userId,
  companyId,
  requestUserId
}: Request): Promise<Response | undefined> => {
  const requestUser = await User.findByPk(requestUserId, { attributes: ["id", "super"] });
  const requestIsSuper = !!requestUser?.super;

  const user = await ShowUserService(userId);

  // Outside super, only users of the requester's own company exist.
  if (!requestIsSuper && user.companyId !== companyId) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  // Only a super user edits a super user (or the super user itself).
  if (user.super && user.id !== requestUserId && !requestIsSuper) {
    throw new AppError("ERR_CANNOT_EDIT_SUPER_USER");
  }

  // Verificar se o usuário é um super administrador
  if (user.super && userData.profile === "user") {
    // Verificar se o usuário está tentando alterar seu próprio perfil para "user"
    if (user.id === requestUserId) {
      throw new AppError("ERR_CANNOT_CHANGE_SUPER_ADMIN_PROFILE_TO_USER");
    }
    // Se não for o próprio usuário tentando alterar seu perfil, lançar um erro padrão
    throw new AppError("ERR_CANNOT_EDIT_SUPER_USER_PROFILE");
  }

  const schema = Yup.object().shape({
    name: Yup.string().min(2),
    email: Yup.string().email(),
    profile: Yup.string().oneOf(PROFILES),
    password: Yup.string()
  });

  const { email, password, profile, name, status, signMessage } = userData;
  const { queueIds, whatsappId } = await scopeUserLinks(
    user.companyId,
    userData.queueIds,
    userData.whatsappId
  );

  try {
    await schema.validate({ email, password, profile, name });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  await user.update({
    email,
    password,
    profile,
    name,
    whatsappId,
    status,
    ...(typeof signMessage === "boolean" ? { signMessage } : {})
  });

  await user.$set("queues", queueIds);

  await user.reload();

  const company = await Company.findByPk(user.companyId);

  const serializedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    profile: user.profile,
    companyId: user.companyId,
    company,
    queues: user.queues,
    status,
    super: user.super,
    signMessage: user.signMessage
  };

  return serializedUser;
};

export default UpdateUserService;
