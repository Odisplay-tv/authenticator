import * as admin from "firebase-admin"
import * as functions from "firebase-functions"
import * as jwt from "jsonwebtoken"

admin.initializeApp()

const JWT_SECRET = String(process.env.JWT_SECRET)
const func = functions.region("europe-west1").https.onCall

type GenerateToken = (_: GenerateTokenInput) => Promise<GenerateTokenOutput>
type GenerateTokenInput = {token: string}
type GenerateTokenOutput = {ok: true; token: string} | {ok: false; message: string}

const generateTokenFunc: GenerateToken = async ({token}) => {
  try {
    await admin.auth().verifyIdToken(token)
    return {ok: true, token: jwt.sign({role: "bo_user"}, JWT_SECRET, {algorithm: "HS256"})}
  } catch (err) {
    return {ok: false, message: err.message}
  }
}

export const generateToken = func(generateTokenFunc)
