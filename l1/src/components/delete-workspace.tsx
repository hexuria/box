"use client";

import { useState, useTransition } from "react";
import { EllipsisVertical, Trash2 } from "lucide-react";
import { destroyBoxAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function DeleteWorkspaceDialog({
  id,
  name,
  open,
  onOpenChange,
}: {
  id: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = name.trim() || id;

  function confirm() {
    setError(null);
    start(async () => {
      const result = await destroyBoxAction(id);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending && !next) {
          return;
        }
        onOpenChange(next);
        if (!next) {
          setError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete workspace?</DialogTitle>
          <DialogDescription>
            This permanently deletes{" "}
            <span className="font-medium text-foreground">{label}</span>
            {label !== id ? (
              <>
                {" "}
                (<span className="font-mono text-xs">{id}</span>)
              </>
            ) : null}
            , including its Linux desktop and files. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={confirm}
          >
            {pending ? "Deleting…" : "Delete workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteWorkspaceButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const label = name.trim() || id;

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="relative z-10 min-h-8 shrink-0"
        aria-label={`Delete workspace ${label}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Trash2 />
        Delete
      </Button>
      <DeleteWorkspaceDialog
        id={id}
        name={name}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export function WorkspaceOverflowMenu({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-8 shrink-0"
            />
          }
        >
          <EllipsisVertical />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 />
            Delete workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteWorkspaceDialog
        id={id}
        name={name}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      />
    </>
  );
}
