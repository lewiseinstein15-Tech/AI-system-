"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Database, Download, Upload, RefreshCw } from "lucide-react";

export default function AdminDatabasePage() {
  const [backupStatus, setBackupStatus] = useState("");
  const [isBackingUp, setIsBackingUp] = useState(false);

  const handleBackup = async () => {
    setIsBackingUp(true);
    setBackupStatus("Initiating database backup...");
    // Simulate API call for backup
    setTimeout(() => {
      setBackupStatus("Backup completed successfully! (Simulated)");
      setIsBackingUp(false);
    }, 2000);
  };

  const handleRestore = () => {
    setBackupStatus("Restoring database from latest backup... (Simulated)");
    setTimeout(() => setBackupStatus(""), 3000);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">Database Management</h1>
        <p className="text-foreground/60">Backup, restore, and manage your PostgreSQL database.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <Download className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold">Backup Database</h2>
          </div>
          <p className="text-sm text-foreground/60">
            Export the entire database schema and data into a single SQL file. This is recommended before major updates.
          </p>
          <Button onClick={handleBackup} disabled={isBackingUp}>
            {isBackingUp ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
            {isBackingUp ? "Backing up..." : "Create Backup"}
          </Button>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <Upload className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold">Restore Database</h2>
          </div>
          <p className="text-sm text-foreground/60">
            Restore the database from a previous backup file. Warning: This will overwrite current data.
          </p>
          <Button variant="destructive" onClick={handleRestore} disabled={isBackingUp}>
            <Upload className="h-4 w-4 mr-2" />
            Restore from Backup
          </Button>
        </div>
      </div>

      {backupStatus && (
        <div className="card border-primary/30 bg-primary/5">
          <p className="text-sm text-primary flex items-center gap-2">
            <Database className="h-4 w-4" />
            {backupStatus}
          </p>
        </div>
      )}
    </div>
  );
}