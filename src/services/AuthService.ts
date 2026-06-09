import { adminAuth } from "@/firebase/firebaseAdmin";
import { headers } from "next/headers";
import { User } from "@/model/User";
import { AppError, errorResponse } from "@/utils/apiResponse";
import { roleRepository } from "@/repositories/RoleRepository";
import { toSafeLocaleString, getNowSL, parseToDayjs } from "./UtilService";
import { notificationRepository } from "@/repositories/NotificationRepository";
import { settingsRepository } from "@/repositories/SettingsRepository";
import { MailService } from "@/services/MailService";
import crypto from "crypto";


/**
 * Basic Auth Guard
 * Verifies only the token. Does NOT check for roles.
 * Useful for public website users (customers).
 */
export const requireAuth = async (req: Request | null) => {
  let authHeader: string | null = null;

  if (req) {
    authHeader = req.headers.get("authorization");
  } else {
    const headersList = await headers();
    authHeader = headersList.get("authorization");
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("Unauthorized: Missing or invalid token", 401);
  }

  const token = authHeader.includes("Bearer ") ? authHeader.split("Bearer ")[1] : authHeader.split(" ")[1];

  try {
    const decodedToken = await adminAuth.verifyIdToken(token, true);
    return decodedToken;
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    console.error("Auth Guard Error:", error);
    throw new AppError("Unauthorized: Invalid or expired session", 401);
  }
};

/**
 * Unified ERP Auth Guard
 * Verifies token, role, and optional permissions.
 * Throws AppError on failure for global handling.
 */
export const requirePermission = async (req: Request | null, permission?: string) => {
  const decodedToken = await requireAuth(req);
  const role = decodedToken.role?.toLowerCase();

  if (!role) {
    throw new AppError("Unauthorized: Access denied (no role)", 403);
  }

  if (role === "admin") return decodedToken;

  if (permission) {
    const roleData = await roleRepository.findById(role);
    const permissions = roleData?.permissions || [];
    if (!roleData || !permissions.includes(permission)) {
      throw new AppError(`Forbidden: Missing permission '${permission}'`, 403);
    }
  }

  return decodedToken;
};


export const verifyPosAuth = (permission?: string) => requirePermission(null, permission);


export const handleAuthError = (error: any) => {
  const status = error instanceof AppError ? error.statusCode : 500;
  return errorResponse(error, status);
};


export const loginUser = async (userId: string) => {
  try {
    console.log(`[AuthService] Attempting login for user: ${userId}`);
    const authUser = await adminAuth.getUser(userId);

    const customClaims = authUser.customClaims || {};
    const role = customClaims.role as string | "";
    console.log(`[AuthService] Firebase user found: ${authUser.email}. Assigned Role: ${role || 'None'}`);

    if (authUser.disabled) {
      console.warn(`[AuthService] Login blocked: User ${authUser.email} is disabled.`);
      throw new AppError(`User with ID ${authUser.email} is not active`, 403);
    }

    let permissions: string[] = [];
    try {
      if (role) {
        const roleData = await roleRepository.findById(role.toLowerCase());
        permissions = roleData?.permissions || [];
        console.log(`[AuthService] Permissions fetched for role ${role}: ${permissions.length} items.`);
      }
    } catch (e) {
      console.warn(`[AuthService] Failed to fetch role permissions for ${role}:`, e);
    }

    const userData: User = {
      userId: authUser.uid,
      email: authUser.email || "",
      username: authUser.displayName || "",
      photoURL: authUser.photoURL || "",
      role: role || "",
      status: !authUser.disabled,
      permissions,
      createdAt: toSafeLocaleString(authUser.metadata.creationTime) || "",
      updatedAt: toSafeLocaleString(authUser.metadata.lastSignInTime) || "",
    };

    console.log(`[AuthService] Login logic completed successfully for ${userData.email}`);
    return userData;
  } catch (e: any) {
    console.error("[AuthService] Login CRITICAL Error for ID:", userId, e);
    if (e instanceof AppError) throw e;
    const message = e?.message || "Login failed";
    throw new AppError(message, 500);
  }
};

export const createUser = async (user: User): Promise<string> => {
  let userId = user.userId;

  if (!userId || user.password) {
    try {
      const authUser = await adminAuth.createUser({
        email: user.email,
        password: user.password,
        displayName: user.username,
        photoURL: user.photoURL,
        disabled: user.status === false,
        phoneNumber: user.phoneNumber || undefined,
      });
      userId = authUser.uid;
    } catch (error: any) {
      if (error.code === "auth/email-already-exists") {
        const existingUser = await adminAuth.getUserByEmail(user.email);
        userId = existingUser.uid;
      } else {
        throw error;
      }
    }
  }

  if (user.role) {
    await adminAuth.setCustomUserClaims(userId, { role: user.role });
  }

  return userId;
};

export const updateUser = async (
  userId: string,
  data: Partial<User>
): Promise<void> => {
  const updates: any = {};
  if (typeof data.status === "boolean") {
    updates.disabled = data.status === false;
  }
  if (data.email) updates.email = data.email;
  if (data.username) updates.displayName = data.username;
  if (data.password) updates.password = data.password;
  if (data.photoURL) updates.photoURL = data.photoURL;
  if (data.phoneNumber) updates.phoneNumber = data.phoneNumber;

  if (Object.keys(updates).length > 0) {
    await adminAuth.updateUser(userId, updates);
  }

  if (data.role) {
    await adminAuth.setCustomUserClaims(userId, { role: data.role });
  }
};

export const verifyUserCredentials = async (
  token: string,
  requiredPermission?: string
): Promise<{ success: boolean; user?: { email: string | undefined; role: string } }> => {
  try {
    // Verify the ID token using Firebase Admin SDK
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    // Fetch user details to ensure account is not disabled
    const authUser = await adminAuth.getUser(uid);
    if (authUser.disabled) {
      throw new AppError("User account is disabled", 403);
    }

    const role = (decodedToken.role as string || "").toLowerCase();

    // Admin has all permissions
    if (role === "admin") {
      return { success: true, user: { email: authUser.email, role } };
    }

    if (requiredPermission) {
      const roleData = await roleRepository.findById(role);
      const permissions = roleData?.permissions || [];
      if (!roleData || !permissions.includes(requiredPermission)) {
        throw new AppError(`Access denied: You do not have the required permission '${requiredPermission}'`, 403);
      }
    }

    return { success: true, user: { email: authUser.email, role } };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    console.error("Token verification failed:", error);
    throw new AppError("Invalid or expired authorization token", 401);
  }
};

const normalizePhone = (phone: string): string => {
  return phone.replace(/[\s\-\(\)\+]/g, "");
};

const hashOTP = (otp: string): string => crypto.createHash("sha256").update(otp).digest("hex");

export const requestPasswordReset = async (email: string, phoneNumber: string): Promise<{ success: boolean; message: string }> => {
  try {
    const user = await adminAuth.getUserByEmail(email);
    if (!user) {
      throw new AppError("User account with this email not found", 404);
    }

    if (!user.phoneNumber) {
      throw new AppError("No registered phone number found for this user. Please contact administration.", 400);
    }

    if (normalizePhone(user.phoneNumber) !== normalizePhone(phoneNumber)) {
      throw new AppError("Provided phone number does not match our records.", 400);
    }

    const now = getNowSL();
    const phoneKey = `email_${email.toLowerCase()}`;
    const lastOtp = await notificationRepository.findLatestOTP(phoneKey);

    if (lastOtp) {
      const lastRequestTime = parseToDayjs(lastOtp.createdAt);
      const secondsSinceLastRequest = lastRequestTime ? now.diff(lastRequestTime, "second") : Infinity;

      if (secondsSinceLastRequest < 60) {
        throw new AppError(`Please wait ${Math.ceil(60 - secondsSinceLastRequest)} seconds before requesting another code.`, 400);
      }

      const expiresAt = parseToDayjs(lastOtp.expiresAt);
      if (!lastOtp.verified && expiresAt && expiresAt.isAfter(now)) {
        throw new AppError("An active verification code already exists. Please check your email.", 400);
      }
    }

    // Generate Email OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = hashOTP(otp);
    const expiresAt = now.add(5, "minute").toDate();

    // Store in otp_verifications using email as the identifier
    await notificationRepository.createOTP({
      phone: phoneKey,
      otpHash,
      createdAt: now.toDate(),
      expiresAt,
      verified: false,
      attempts: 0,
      ttl: now.add(1, "day").toDate(),
    });

    // Seed suitable email template if missing
    const templateId = "password_reset_otp";
    const existingTemplate = await notificationRepository.getMailTemplate(templateId);
    if (!existingTemplate) {
      const templateHtml = `<div style="font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8faf5; color: #111827; margin: 0; padding: 16px 8px; width: 100%; box-sizing: border-box;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(46, 158, 91, 0.08); border: 1px solid #e0e8d8;">
    <div style="text-align: center; padding: 28px 16px 16px 16px;">
      <img src="https://neverbe.lk/mail-logo.png" alt="NEVERBE" width="120" style="display: block; margin: 0 auto;" />
    </div>
    <div style="padding: 0 24px; text-align: center;">
      <h1 style="font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.03em; margin: 0 0 8px 0; color: #0e331c; line-height: 1.1;">
        Security Verification
      </h1>
      <p style="color: #2e9e5b; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 20px 0;">
        PASSWORD RESET OTP
      </p>
      <p style="font-size: 15px; line-height: 1.6; color: #374151; margin: 0 auto 20px auto;">
        We received a request to reset your password. Use the following security code to proceed:
      </p>
      <div style="background-color: #f8faf5; border-radius: 12px; padding: 18px; text-align: center; margin: 20px 0; border: 1px solid #e0e8d8;">
        <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0e331c;">{{otp}}</span>
      </div>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin-bottom: 28px;">
        This code is valid for 5 minutes. If you did not request this, please ignore this email.
      </p>
    </div>
    <div style="background-color: #0e331c; padding: 28px 24px; text-align: center; color: #ffffff;">
      <div style="font-size: 11px; color: #a1ceb4; line-height: 1.8; font-weight: 400;">
        <strong style="color: #ffffff; font-size: 13px; display: block; margin-bottom: 8px;">NEVERBE, Inc.</strong>
        330/4/10 New Kandy Road, Delgoda<br>
        Hotline: 070 520 8990 | 072 924 9999
      </div>
    </div>
  </div>
</div>`;
      await notificationRepository.saveMailTemplate(templateId, {
        subject: "NEVERBE: Password Recovery Verification Code",
        html: templateHtml
      });
    }

    const mailResult = await MailService.sendTemplateEmail([email], templateId, { otp });
    if (!mailResult.success) {
      throw new AppError("Failed to send OTP to email. Please try again later.", 500);
    }

    return { success: true, message: "OTP sent successfully to email." };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    console.error("requestPasswordReset error:", error);
    throw new AppError(error.message || "Failed to initiate password reset", 500);
  }
};

export const verifyPasswordResetEmail = async (email: string, otp: string): Promise<{ success: boolean; message: string }> => {
  try {
    const phoneKey = `email_${email.toLowerCase()}`;
    const lastOtp = await notificationRepository.findLatestOTP(phoneKey);
    if (!lastOtp) throw new AppError("No OTP found.", 400);

    const now = getNowSL();
    const expiresAt = parseToDayjs(lastOtp.expiresAt);
    if (lastOtp.verified) throw new AppError("OTP already verified.", 400);
    if (!expiresAt || now.isAfter(expiresAt)) throw new AppError("OTP expired.", 400);

    if (lastOtp.attempts && lastOtp.attempts >= 3) {
      throw new AppError("Too many failed attempts. Please request a new verification code.", 400);
    }

    if (lastOtp.otpHash !== hashOTP(otp)) {
      const newAttempts = (lastOtp.attempts || 0) + 1;
      await notificationRepository.updateOTP(lastOtp.id, { attempts: newAttempts });
      throw new AppError("Invalid verification code.", 400);
    }

    // Now send the Phone OTP
    const user = await adminAuth.getUserByEmail(email);
    if (!user || !user.phoneNumber) {
      throw new AppError("Could not retrieve user phone number.", 400);
    }

    const phoneOtpKey = user.phoneNumber;
    const lastPhoneOtp = await notificationRepository.findLatestOTP(phoneOtpKey);
    if (lastPhoneOtp) {
      const lastRequestTime = parseToDayjs(lastPhoneOtp.createdAt);
      const secondsSinceLastRequest = lastRequestTime ? now.diff(lastRequestTime, "second") : Infinity;

      if (secondsSinceLastRequest < 60) {
        throw new AppError(`Please wait ${Math.ceil(60 - secondsSinceLastRequest)} seconds before requesting a phone code.`, 400);
      }

      const phoneExpiresAtVal = parseToDayjs(lastPhoneOtp.expiresAt);
      if (!lastPhoneOtp.verified && phoneExpiresAtVal && phoneExpiresAtVal.isAfter(now)) {
        throw new AppError("An active verification code already exists on your phone.", 400);
      }
    }

    await notificationRepository.updateOTP(lastOtp.id, { verified: true, verifiedAt: now.toDate() });

    const phoneOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const phoneOtpHash = hashOTP(phoneOtp);
    const phoneExpiresAt = now.add(5, "minute").toDate();

    await notificationRepository.createOTP({
      phone: user.phoneNumber,
      otpHash: phoneOtpHash,
      createdAt: now.toDate(),
      expiresAt: phoneExpiresAt,
      verified: false,
      attempts: 0,
      ttl: now.add(1, "day").toDate(),
    });

    // Send SMS using suitable SMS template
    const text = await renderPasswordResetSMS(phoneOtp);
    const TEXT_API_KEY = process.env.TEXT_API_KEY;
    if (TEXT_API_KEY) {
      await fetch("https://api.textit.biz/", {
        method: "POST",
        headers: { Authorization: `Basic ${TEXT_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: user.phoneNumber, text }),
      });
    } else {
      console.warn("TEXT_API_KEY not found. SMS code logged to console:", phoneOtp);
    }

    return { success: true, message: "Email OTP verified. OTP sent to registered phone number." };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    console.error("verifyPasswordResetEmail error:", error);
    throw new AppError(error.message || "Failed to verify email OTP", 500);
  }
};

const renderPasswordResetSMS = async (otp: string): Promise<string> => {
  try {
    let template = await settingsRepository.getSmsTemplate("PASSWORD_RESET_OTP");
    if (!template) {
      template = {
        name: "Password Reset OTP",
        variables: ["otp"],
        en: "Your NEVERBE password reset verification code is {{otp}}. Valid for 5 minutes.",
        si: "ඔබගේ NEVERBE මුරපදය නැවත සැකසීමේ කේතය {{otp}} වේ. මෙය විනාඩි 5ක් සඳහා වලංගු වේ.",
        ta: "உங்களது NEVERBE கடவுச்சொல் மீட்டமைப்பு குறியீடு {{otp}} ஆகும். இது 5 நிமிடங்களுக்கு செல்லுபடியாகும்.",
      };
      await settingsRepository.collection.firestore.collection("sms_templates").doc("PASSWORD_RESET_OTP").set(template);
    }
    
    const processTemplate = (content: string, data: Record<string, any>) => {
      let processed = content;
      Object.keys(data).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        processed = processed.replace(regex, data[key] || '');
      });
      return processed;
    };

    const parts = [];
    if (template.en) parts.push(processTemplate(template.en, { otp }));
    if (template.si) parts.push(processTemplate(template.si, { otp }));
    if (template.ta) parts.push(processTemplate(template.ta, { otp }));

    let message = parts.join("\n\n");
    if (template.common) {
      const processedCommon = processTemplate(template.common, { otp });
      if (processedCommon.trim()) message += "\n\n" + processedCommon;
    }
    return message;
  } catch (error) {
    return `NEVERBE: Your password reset verification code is ${otp}. Valid for 5 minutes.`;
  }
};

export const resetUserPasswordCustom = async (
  email: string,
  phoneNumber: string,
  phoneOtp: string,
  password: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const user = await adminAuth.getUserByEmail(email);
    if (!user) throw new AppError("User not found.", 404);

    if (!user.phoneNumber || normalizePhone(user.phoneNumber) !== normalizePhone(phoneNumber)) {
      throw new AppError("User credentials mismatch.", 400);
    }

    const lastOtp = await notificationRepository.findLatestOTP(user.phoneNumber);
    if (!lastOtp) throw new AppError("No verification code found for this phone number.", 400);

    const now = getNowSL();
    const expiresAt = parseToDayjs(lastOtp.expiresAt);
    if (lastOtp.verified) throw new AppError("OTP already verified.", 400);
    if (!expiresAt || now.isAfter(expiresAt)) throw new AppError("OTP expired.", 400);

    if (lastOtp.attempts && lastOtp.attempts >= 3) {
      throw new AppError("Too many failed attempts. Please request a new verification code.", 400);
    }

    if (lastOtp.otpHash !== hashOTP(phoneOtp)) {
      const newAttempts = (lastOtp.attempts || 0) + 1;
      await notificationRepository.updateOTP(lastOtp.id, { attempts: newAttempts });
      throw new AppError("Invalid verification code.", 400);
    }

    // Verify and consume OTP
    await notificationRepository.updateOTP(lastOtp.id, { verified: true, verifiedAt: now.toDate(), consumed: true, consumedAt: now.toDate() });

    // Update password
    await adminAuth.updateUser(user.uid, { password });

    return { success: true, message: "Password updated successfully." };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    console.error("resetUserPasswordCustom error:", error);
    throw new AppError(error.message || "Failed to reset password", 500);
  }
};
