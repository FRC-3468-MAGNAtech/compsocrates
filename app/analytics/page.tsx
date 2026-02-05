import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

export default async function AnalyticsPage() {
  const snapshot = await getDocs(collection(db, "scouting"));
  const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Analytics</h1>

      <pre className="bg-gray-100 p-4 rounded">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}