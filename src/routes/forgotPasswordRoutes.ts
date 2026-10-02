import express from "express";
import isAuth from "../middleware/isAuth";


import * as ForgotController from "../controllers/ForgotController";

const forgotsRoutes = express.Router();

forgotsRoutes.post("/forgetpassword", ForgotController.store);
forgotsRoutes.post("/resetpasswords", ForgotController.resetPasswords);


export default forgotsRoutes;