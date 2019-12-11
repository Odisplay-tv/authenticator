import * as admin from "firebase-admin"
import * as functions from "firebase-functions"
import * as jwt from "jsonwebtoken"

admin.initializeApp()

const JWT_SECRET = String(process.env.JWT_SECRET)
const EXP_DELAY = 60 * 60 * 30 // 30 min

type GenerateToken = (_: GenerateTokenInput) => Promise<GenerateTokenOutput>
type GenerateTokenInput = {idToken: string}
type GenerateTokenOutput = {ok: true; token: string} | {ok: false; message: string}

const generateTokenFunc: GenerateToken = async ({idToken}) => {
  try {
    await admin.auth().verifyIdToken(idToken)
    const payload = {role: "bo_user", exp: Math.round(Date.now() / 1000) + EXP_DELAY}
    const opts = {algorithm: "HS256"}
    return {ok: true, token: jwt.sign(payload, JWT_SECRET, opts)}
  } catch (err) {
    return {ok: false, message: err.message}
  }
}

const onCall = functions.region("europe-west1").https.onCall
export const generateToken = onCall(generateTokenFunc)
