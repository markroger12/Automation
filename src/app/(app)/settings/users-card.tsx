'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { Alert, Badge, Button, Card, Field, Input, Modal, Select } from '@/components/ui';

type U = { id: string; name: string; email: string; role: 'ADMIN' | 'EDITOR'; lastLoginAt: string | null };

export function UsersCard() {
  const [users, setUsers] = useState<U[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'EDITOR' as 'ADMIN' | 'EDITOR' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<{ users: U[] }>('/api/users').then((r) => setUsers(r.users)).catch(() => undefined), []);
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/users', { body: form });
      setOpen(false);
      setForm({ name: '', email: '', password: '', role: 'EDITOR' });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: U) {
    if (!confirm(`Delete ${u.email}?`)) return;
    try {
      await api(`/api/users/${u.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <Card
      title="Users"
      description="Editors can write and manage articles. Only admins change settings and keys."
      actions={
        <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setOpen(true)}>
          Add user
        </Button>
      }
    >
      <ul className="divide-y divide-gray-100">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div>
              <span className="font-medium">{u.name}</span> <span className="text-gray-500">{u.email}</span>{' '}
              <Badge color={u.role === 'ADMIN' ? 'purple' : 'gray'}>{u.role.toLowerCase()}</Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {u.lastLoginAt ? `Last sign-in ${new Date(u.lastLoginAt).toLocaleString()}` : 'Never signed in'}
              <button onClick={() => remove(u)} className="rounded p-1 hover:bg-gray-100" title="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add user"
        footer={
          <Button variant="primary" onClick={add} loading={busy}>
            Add
          </Button>
        }
      >
        <div className="space-y-3">
          {error && <Alert type="error">{error}</Alert>}
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password" help="At least 10 characters.">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'ADMIN' | 'EDITOR' })}>
              <option value="EDITOR">Editor</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
