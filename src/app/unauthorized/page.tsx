import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-center">
      <ShieldAlert className="h-16 w-16 text-red-500 mb-4" />
      <h1 className="text-3xl font-bold text-foreground mb-2">Access Denied</h1>
      <p className="text-foreground/60 mb-6 max-w-md">
        You do not have the required permissions to view this page. If you believe this is an error, please contact an administrator.
      </p>
      <Link href="/">
        <Button variant="outline">Return to Home</Button>
      </Link>
    </div>
  );
}