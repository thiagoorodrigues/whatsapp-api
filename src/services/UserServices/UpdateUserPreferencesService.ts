import * as Yup from "yup";

import AppError from "../../errors/AppError";
import ShowUserService from "./ShowUserService";
import { SerializeUser } from "../../helpers/SerializeUser";

interface Request {
  userId: string | number;
  signMessage: unknown;
}

// What any user may change about themselves, without the admin-only
// user update (profile, queues, connection).
const UpdateUserPreferencesService = async ({ userId, signMessage }: Request) => {
  const schema = Yup.object().shape({ signMessage: Yup.boolean().strict().required() });

  try {
    await schema.validate({ signMessage });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const user = await ShowUserService(userId);
  await user.update({ signMessage });

  return SerializeUser(user);
};

export default UpdateUserPreferencesService;
