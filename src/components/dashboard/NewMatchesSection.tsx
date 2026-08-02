import MatchCard from "./MatchCard";
import { NEW_MATCHES } from "@/lib/dashboardData";

export default function NewMatchesSection() {
  return (
    <div className="space-y-6">
      {NEW_MATCHES.map((match) => (
        <MatchCard key={match.id} match={match} />
      ))}
    </div>
  );
}
