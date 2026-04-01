"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  User,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  updateProfile,
  sendEmailVerification
} from "firebase/auth";
import { collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { auth, db } from "@/app/firebase";
import { setSecureUserDoc } from "@/app/utils/secureUserDoc";
import { TeamRole, normalizeLegacyRole } from "@/app/utils/roles";
import { withHiddenOwnerPermissions } from "@/app/utils/ownerPermissions";
import { parseTeamTimeOverride, type TeamTimeOverride } from "@/app/utils/teamTime";

// User data structure
export type UserRole = TeamRole | "scout" | "coach";

export type UserData = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  roles?: TeamRole[];
  secondaryRoles?: TeamRole[];
  specialRole?: string | null;
  specialRoles?: string[];
  formAccessOverrides?: Record<string, string[]>;
  teamId: string;
  isTeamAdmin: boolean;
  photoURL?: string;
  bio?: string;
  profileVisibility?: "team" | "public" | "private";
  profileComplete?: boolean;
  preferredDashboard?: string;
  canManageVersionReleases?: boolean;
  emailVerificationExempt?: boolean;
  accountThemeId?: string;
  accountFontId?: string;
  experiencedScout?: boolean;
};

type AuthContextType = {
  user: User | null;
  currentUser: User | null;
  userData: UserData | null;
  teamTimeOverride: TeamTimeOverride | null;
  loading: boolean;
  signUp: (email: string, password: string, name: string, role: UserRole, teamId: string, isTeamAdmin: boolean) => Promise<string>;
  signIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  updateUserData: (updates: Partial<UserData>) => Promise<void>;
  refreshUserData: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  currentUser: null,
  userData: null,
  teamTimeOverride: null,
  loading: true,
  signUp: async () => "",
  signIn: async () => {},
  logOut: async () => {},
  updateUserData: async () => {},
  refreshUserData: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [teamTimeOverride, setTeamTimeOverride] = useState<TeamTimeOverride | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Load user data from Firestore
  async function loadUserData(uid: string) {
    try {
      const userDoc = await getDoc(doc(db, "users", uid));
      if (userDoc.exists()) {
        const data = userDoc.data() as UserData & { encryptedUserData?: string };
        setUserData(withHiddenOwnerPermissions(data));
        if (!data.encryptedUserData) {
          await setSecureUserDoc(uid, data, true);
        }
      }
    } catch (error) {
      console.error("Error loading user data:", error);
    }
  }

  function buildDefaultUserData(currentUser: User): UserData {
    const fallbackName =
      String(currentUser.displayName || "").trim() ||
      String(currentUser.email || "").split("@")[0] ||
      "User";
    return {
      uid: currentUser.uid,
      email: currentUser.email || "",
      displayName: fallbackName,
      role: "match-scout",
      roles: ["match-scout"],
      secondaryRoles: [],
      teamId: "",
      isTeamAdmin: false,
      profileVisibility: "team",
      bio: "",
      photoURL: currentUser.photoURL || "",
      emailVerificationExempt: false,
      profileComplete: true,
      experiencedScout: false,
    };
  }

  async function syncApprovedJoinRequest(uid: string, current: UserData): Promise<UserData> {
    if (!uid || current.teamId) return current;
    try {
      const requestsQuery = query(collection(db, "teamJoinRequests"), where("userId", "==", uid));
      const requestsSnap = await getDocs(requestsQuery);
      type ApprovedJoinRow = {
        id: string;
        status?: unknown;
        teamId?: unknown;
        requestedRole?: unknown;
        userRole?: unknown;
        role?: unknown;
        processedAt?: unknown;
        createdAt?: unknown;
      };
      const approved = requestsSnap.docs
        .map((docSnap): ApprovedJoinRow => ({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) }))
        .filter((row) => String(row.status || "") === "approved" && String(row.teamId || "").trim())
        .sort((a, b) => Number(b.processedAt || b.createdAt || 0) - Number(a.processedAt || a.createdAt || 0))[0];

      if (!approved) return current;

      const nextRole = normalizeLegacyRole(String(approved.requestedRole || approved.userRole || approved.role || current.role || "match-scout"));
      const nextTeamId = String(approved.teamId || "").trim();
      const updates: Partial<UserData> = {
        teamId: nextTeamId,
        role: nextRole,
        roles: [nextRole],
        specialRole: null,
        specialRoles: [],
      };
      await setSecureUserDoc(uid, updates as Record<string, unknown>, true);
      try {
        await updateDoc(doc(db, "teamJoinRequests", String(approved.id || "")), {
          profileSyncPending: false,
          profileSyncedAt: Date.now(),
        });
      } catch {
        // Best-effort marker update only.
      }
      return { ...current, ...updates };
    } catch {
      return current;
    }
  }

  // Update user data
  async function updateUserData(updates: Partial<UserData>) {
    if (!user) return;
    
    try {
      await setSecureUserDoc(user.uid, updates as Record<string, unknown>, true);
      setUserData(prev => (prev ? withHiddenOwnerPermissions({ ...prev, ...updates }) : null));
    } catch (error) {
      console.error("Error updating user data:", error);
      throw error;
    }
  }

  // Refresh user data from Firestore
  async function refreshUserData() {
    if (!user) return;
    await loadUserData(user.uid);
  }

  // Sign up new user
  async function signUp(
    email: string, 
    password: string, 
    name: string, 
    role: UserRole, 
    teamId: string,
    isTeamAdmin: boolean
  ): Promise<string> {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const continueUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/verify-email?email=${encodeURIComponent(email)}`
        : "https://compsocrates.app/verify-email";
    await sendEmailVerification(userCredential.user, {
      url: continueUrl,
      handleCodeInApp: false,
    });
    alert("Verification email sent! Please check your inbox.");
    
    // Update display name
    await updateProfile(userCredential.user, { displayName: name });
    
    // Store user data in Firestore
    const normalizedRole = normalizeLegacyRole(role);
    const userData: UserData = {
      uid: userCredential.user.uid,
      email: email,
      displayName: name,
      role: normalizedRole,
      roles: [normalizedRole],
      teamId: teamId,
      isTeamAdmin: isTeamAdmin,
      profileVisibility: "team",
      bio: "",
      emailVerificationExempt: false,
      profileComplete: true,
    };
    
    await setSecureUserDoc(userCredential.user.uid, userData as unknown as Record<string, unknown>, false);
    return userCredential.user.uid;
  }

  // Sign in existing user
  async function signIn(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  // Log out
  async function logOut() {
    await signOut(auth);
    setUser(null);
    setUserData(null);
  }

  // Listen for auth state changes
  useEffect(() => {
    void setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.error("Failed to set auth persistence:", error);
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        if (userDoc.exists()) {
          const loaded = userDoc.data() as UserData;
          if (loaded.profileComplete === false) {
            setUserData(withHiddenOwnerPermissions(loaded));
            setLoading(false);
            return;
          }
          const isEmailExempt = loaded.emailVerificationExempt === true;
          if (!currentUser.emailVerified && !isEmailExempt) {
            router.push("/verify-email");
            setLoading(false);
            return;
          }

          const hydrated = await syncApprovedJoinRequest(currentUser.uid, loaded);
          setUserData(withHiddenOwnerPermissions(hydrated));
        } else {
          const isGoogleUser = currentUser.providerData.some((provider) => provider.providerId === "google.com");
          if (!currentUser.emailVerified && !isGoogleUser) {
            router.push("/verify-email");
            setLoading(false);
            return;
          }
          if (isGoogleUser) {
            setUserData(withHiddenOwnerPermissions({ ...buildDefaultUserData(currentUser), profileComplete: false }));
            setLoading(false);
            return;
          }

          const fallbackUserData = buildDefaultUserData(currentUser);
          try {
            await setSecureUserDoc(currentUser.uid, fallbackUserData as unknown as Record<string, unknown>, false);
          } catch (error) {
            console.error("Error creating missing user doc on login:", error);
          }
          const hydrated = await syncApprovedJoinRequest(currentUser.uid, fallbackUserData);
          setUserData(withHiddenOwnerPermissions(hydrated));
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [router]);

  useEffect(() => {
    if (!userData?.teamId) {
      setTeamTimeOverride(null);
      return;
    }
    const teamRef = doc(db, "teams", userData.teamId);
    const unsubscribe = onSnapshot(
      teamRef,
      (snap) => {
        if (!snap.exists()) {
          setTeamTimeOverride(null);
          return;
        }
        setTeamTimeOverride(parseTeamTimeOverride(snap.data()));
      },
      (error) => {
        console.error("Failed to load team time override:", error);
        setTeamTimeOverride(null);
      }
    );
    return () => unsubscribe();
  }, [userData?.teamId]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      currentUser: user,
      userData,
      teamTimeOverride,
      loading, 
      signUp, 
      signIn, 
      logOut, 
      updateUserData,
      refreshUserData
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
