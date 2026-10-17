"use client";

import {
  BanIcon,
  CheckCircle2Icon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  PrinterIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isAppLocale, LOCALE_LABELS } from "@/lib/locale-resolution";
import { LOCALES } from "@/lib/localized-text";
import {
  createAdminAction,
  createDriverAction,
  resetDriverPinAction,
  setDriverLocaleAction,
  setUserActiveAction,
} from "@/server/user-actions";
import type { UserError } from "@/server/users";

export type UserListRow = {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  locale: string;
  active: boolean;
  /** Already formatted in the viewer's locale and the factory time zone. */
  lastLogin: string | null;
};

const ERROR_KEYS: Record<UserError, string> = {
  invalid: "invalid",
  username_taken: "usernameTaken",
  email_taken: "emailTaken",
  not_found: "notFound",
  self: "self",
};

type PinSheet = { name: string; username: string; pin: string };
type Confirm = { kind: "reset" | "deactivate"; user: UserListRow };

export function UsersManager({
  drivers,
  admins,
  currentUserId,
}: {
  drivers: UserListRow[];
  admins: UserListRow[];
  currentUserId: string;
}) {
  const t = useTranslations("admin.drivers");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState<"driver" | "admin" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pinSheet, setPinSheet] = useState<PinSheet | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const errorText = (error: UserError) => t(`errors.${ERROR_KEYS[error]}`);

  async function run<T extends { ok: boolean }>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  function onCreate(kind: "driver" | "admin", event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);
    startTransition(async () => {
      if (kind === "driver") {
        const input = {
          displayName: form.get("displayName"),
          username: form.get("username"),
          locale: form.get("locale"),
        };
        const result = await run(() => createDriverAction(input));
        if (!result) return setFormError(t("errors.generic"));
        if (!result.ok) return setFormError(errorText(result.error));
        setCreateOpen(null);
        setPinSheet({
          name: String(input.displayName).trim(),
          username: String(input.username).trim().toLowerCase(),
          pin: result.pin,
        });
      } else {
        const input = {
          displayName: form.get("displayName"),
          email: form.get("email"),
          password: form.get("password"),
        };
        const result = await run(() => createAdminAction(input));
        if (!result) return setFormError(t("errors.generic"));
        if (!result.ok) return setFormError(errorText(result.error));
        setCreateOpen(null);
      }
      router.refresh();
    });
  }

  function onConfirm() {
    if (!confirm) return;
    const { kind, user } = confirm;
    setConfirmError(null);
    startTransition(async () => {
      if (kind === "reset") {
        const result = await run(() => resetDriverPinAction(user.id));
        if (!result) return setConfirmError(t("errors.generic"));
        if (!result.ok) return setConfirmError(errorText(result.error));
        setConfirm(null);
        setPinSheet({ name: user.displayName, username: user.username ?? "", pin: result.pin });
      } else {
        const result = await run(() => setUserActiveAction(user.id, false));
        if (!result) return setConfirmError(t("errors.generic"));
        if (!result.ok) return setConfirmError(errorText(result.error));
        setConfirm(null);
        toast.success(t("toast.deactivated", { name: user.displayName }));
      }
      router.refresh();
    });
  }

  function reactivate(user: UserListRow) {
    startTransition(async () => {
      const result = await run(() => setUserActiveAction(user.id, true));
      if (!result) {
        toast.error(t("errors.generic"));
        return;
      }
      if (!result.ok) {
        toast.error(errorText(result.error));
        return;
      }
      toast.success(t("toast.activated", { name: user.displayName }));
      router.refresh();
    });
  }

  function changeLocale(user: UserListRow, locale: string) {
    startTransition(async () => {
      const result = await run(() => setDriverLocaleAction(user.id, locale));
      if (!result) {
        toast.error(t("errors.generic"));
        return;
      }
      if (!result.ok) {
        toast.error(errorText(result.error));
        return;
      }
      toast.success(t("toast.localeChanged", { name: user.displayName }));
      router.refresh();
    });
  }

  const statusBadge = (active: boolean) =>
    active ? (
      <Badge variant="success">
        <CheckCircle2Icon aria-hidden />
        {t("status.active")}
      </Badge>
    ) : (
      <Badge variant="secondary">
        <BanIcon aria-hidden />
        {t("status.inactive")}
      </Badge>
    );

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4" aria-labelledby="drivers-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 id="drivers-heading" className="text-3xl font-semibold" data-testid="section-title">
              {t("title")}
            </h1>
            <p className="text-base text-muted-foreground">{t("description")}</p>
          </div>
          <Button
            data-testid="create-driver"
            onClick={() => {
              setFormError(null);
              setCreateOpen("driver");
            }}
          >
            <PlusIcon aria-hidden />
            {t("create")}
          </Button>
        </div>

        {drivers.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-base text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table data-testid="drivers-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.username")}</TableHead>
                  <TableHead>{t("columns.language")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.lastLogin")}</TableHead>
                  <TableHead>{t("columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers.map((user) => (
                  <TableRow key={user.id} data-testid={`driver-row-${user.username}`}>
                    <TableCell className="font-medium">{user.displayName}</TableCell>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>
                      <select
                        className="min-h-10 rounded-md border border-input bg-background px-2 text-base"
                        aria-label={t("actions.changeLanguage", { name: user.displayName })}
                        value={user.locale}
                        disabled={pending}
                        onChange={(event) => {
                          if (isAppLocale(event.target.value))
                            changeLocale(user, event.target.value);
                        }}
                      >
                        {LOCALES.map((code) => (
                          <option key={code} value={code} lang={code}>
                            {LOCALE_LABELS[code]}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>{statusBadge(user.active)}</TableCell>
                    <TableCell>{user.lastLogin ?? t("neverLoggedIn")}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {user.active ? (
                          <>
                            <Button
                              variant="outline"
                              data-testid="reset-pin"
                              onClick={() => {
                                setConfirmError(null);
                                setConfirm({ kind: "reset", user });
                              }}
                            >
                              <KeyRoundIcon aria-hidden />
                              {t("actions.resetPin")}
                            </Button>
                            <Button
                              variant="outline"
                              data-testid="deactivate"
                              onClick={() => {
                                setConfirmError(null);
                                setConfirm({ kind: "deactivate", user });
                              }}
                            >
                              <BanIcon aria-hidden />
                              {t("actions.deactivate")}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            data-testid="reactivate"
                            disabled={pending}
                            onClick={() => reactivate(user)}
                          >
                            <CheckCircle2Icon aria-hidden />
                            {t("actions.reactivate")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="admins-heading">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="admins-heading" className="text-2xl font-semibold">
            {t("admins.title")}
          </h2>
          <Button
            variant="outline"
            data-testid="create-admin"
            onClick={() => {
              setFormError(null);
              setCreateOpen("admin");
            }}
          >
            <PlusIcon aria-hidden />
            {t("admins.create")}
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="admins-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("admins.email")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.lastLogin")}</TableHead>
                <TableHead>{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((user) => (
                <TableRow key={user.id} data-testid={`admin-row-${user.email}`}>
                  <TableCell className="font-medium">
                    {user.displayName}
                    {user.id === currentUserId ? (
                      <span className="ms-2 text-sm text-muted-foreground">
                        ({t("admins.you")})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{statusBadge(user.active)}</TableCell>
                  <TableCell>{user.lastLogin ?? t("neverLoggedIn")}</TableCell>
                  <TableCell>
                    {user.id === currentUserId ? null : user.active ? (
                      <Button
                        variant="outline"
                        data-testid="deactivate"
                        onClick={() => {
                          setConfirmError(null);
                          setConfirm({ kind: "deactivate", user });
                        }}
                      >
                        <BanIcon aria-hidden />
                        {t("actions.deactivate")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        data-testid="reactivate"
                        disabled={pending}
                        onClick={() => reactivate(user)}
                      >
                        <CheckCircle2Icon aria-hidden />
                        {t("actions.reactivate")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={createOpen !== null} onOpenChange={(open) => !open && setCreateOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createOpen === "admin" ? t("admins.formTitle") : t("form.title")}
            </DialogTitle>
            <DialogDescription>
              {createOpen === "admin" ? t("admins.passwordHint") : t("form.usernameHint")}
            </DialogDescription>
          </DialogHeader>
          {createOpen ? (
            <form
              className="flex flex-col gap-4"
              data-testid={`create-${createOpen}-form`}
              onSubmit={(event) => onCreate(createOpen, event)}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="displayName">{t("form.displayName")}</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  required
                  maxLength={80}
                  autoComplete="off"
                />
              </div>
              {createOpen === "driver" ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="username">{t("form.username")}</Label>
                    <Input
                      id="username"
                      name="username"
                      required
                      minLength={3}
                      maxLength={32}
                      autoCapitalize="none"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="locale">{t("form.locale")}</Label>
                    <select
                      id="locale"
                      name="locale"
                      defaultValue="de"
                      className="min-h-10 rounded-md border border-input bg-background px-3 text-base"
                    >
                      {LOCALES.map((code) => (
                        <option key={code} value={code} lang={code}>
                          {LOCALE_LABELS[code]}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="email">{t("admins.email")}</Label>
                    <Input id="email" name="email" type="email" required autoComplete="off" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="password">{t("admins.password")}</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      required
                      minLength={10}
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}
              {formError ? (
                <p
                  role="alert"
                  className="text-base font-medium text-destructive"
                  data-testid="form-error"
                >
                  {formError}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={pending} data-testid="create-submit">
                  {t("form.submit")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm
                ? t(confirm.kind === "reset" ? "confirm.resetTitle" : "confirm.deactivateTitle", {
                    name: confirm.user.displayName,
                  })
                : null}
            </DialogTitle>
            <DialogDescription>
              {confirm
                ? t(confirm.kind === "reset" ? "confirm.resetBody" : "confirm.deactivateBody")
                : null}
            </DialogDescription>
          </DialogHeader>
          {confirmError ? (
            <p role="alert" className="text-base font-medium text-destructive">
              {confirmError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {/* shared label */}
              <CancelLabel />
            </Button>
            <Button disabled={pending} data-testid="confirm-submit" onClick={onConfirm}>
              {confirm?.kind === "reset" ? t("actions.resetPin") : t("actions.deactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pinSheet !== null} onOpenChange={(open) => !open && setPinSheet(null)}>
        <DialogContent className="pin-sheet" data-testid="pin-dialog">
          {pinSheet ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("pin.title", { name: pinSheet.name })}</DialogTitle>
                <DialogDescription>{t("pin.warning")}</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3">
                <div>
                  <dt className="text-sm text-muted-foreground">{t("pin.username")}</dt>
                  <dd className="text-xl font-semibold" data-testid="pin-username">
                    {pinSheet.username}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{t("pin.label")}</dt>
                  <dd
                    className="font-mono text-5xl font-bold tracking-[0.3em]"
                    data-testid="pin-value"
                  >
                    {pinSheet.pin}
                  </dd>
                </div>
              </dl>
              <DialogFooter className="print:hidden">
                <Button
                  variant="outline"
                  data-testid="pin-copy"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(pinSheet.pin)
                      .then(() => toast.success(t("pin.copied")))
                      .catch(() => toast.error(t("errors.generic")));
                  }}
                >
                  <CopyIcon aria-hidden />
                  {t("pin.copy")}
                </Button>
                <Button variant="outline" data-testid="pin-print" onClick={() => window.print()}>
                  <PrinterIcon aria-hidden />
                  {t("pin.print")}
                </Button>
                <Button data-testid="pin-done" onClick={() => setPinSheet(null)}>
                  {t("pin.done")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CancelLabel() {
  const t = useTranslations("common.actions");
  return <>{t("cancel")}</>;
}
