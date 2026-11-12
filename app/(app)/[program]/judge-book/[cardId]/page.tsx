"use client";

import { useParams } from "next/navigation";
import { CardDetailView } from "@/components/judge-book/card-detail-view";

export default function JudgeBookCardPage() {
  const params = useParams<{ cardId: string }>();
  return <CardDetailView cardId={decodeURIComponent(params.cardId)} />;
}
