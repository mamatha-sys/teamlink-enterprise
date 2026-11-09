// ---------------------------------------------------------------------------
// PERSONAL EMAIL AND COMPANY EMAIL (founder 2026-11-06: "personal email ni contact email ga, company email ni login email ga separate cheyyadam").
//
// A person comes in on a personal email: the candidate login before joining, then the employee login made at joining (utils/joining.js, utils/internalOnboarding.js).
// After joining HR gives them a company email (cPanel, or from here: utils/cpanelMail.js) and from then on:
//   Employee.personalEmail   the address they came with. Kept for good: offer, documents, password recovery. Set once, never changed here.
//   Employee.companyEmail    the address HR gave. It is also Employee.email (what every mail, notification and HRMS screen uses) and User.email (the login).
// The User row stays the same row: only its email moves, so attendance, payroll and ATS history stay attached to the person.
//
//   assign(actor, employee, { email, personalEmail })   checks, moves the login(s), signs old sessions out, audits, mails the personal address, ticks the onboarding task
//   movedLogin(typed, password)   a right password on the old personal address: tell them the login moved (a wrong one learns nothing)
//   recoveryLogin(typed)          "Forgot password" with the personal address: the link goes to the personal address
//   emailLocked(employeeId, email)   the profile forms cannot change a company email: only assign() can
//
// The four columns are read and written with plain SQL (like utils/loginAccounts.js), so this works before and after the Prisma client is regenerated.
// ---------------------------------------------------------------------------
const bcrypt = require('bcryptjs');
const { strengthError, passwordEventData } = require('./passwordPolicy');
const prisma = require('../db');
const { logAudit } = require('./audit');
const LA = require('./loginAccounts');
const CP = require('./cpanelMail');
const { LEFT } = require('./leftLogin');

const norm = (e) => LA.normEmail(LA.cleanTyped(e));
const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|rediffmail|icloud|protonmail|aol|zoho)\./i;
const TASK = 'Company email assigned';

// the domains a company email may have: COMPANY_EMAIL_DOMAINS (comma list), else the cPanel domain; none set = any that is not a free mail service
const allowedDomains = () => String(process.env.COMPANY_EMAIL_DOMAINS || CP.domain() || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

async function columns(employeeId) {
  const rows = await prisma.$queryRawUnsafe('SELECT "personalEmail", "companyEmail", "companyEmailAt", "companyEmailBy" FROM "Employee" WHERE "id" = ?', String(employeeId));
  return rows[0] || null;
}

// every login of this person: the main one and the extra logins on the same record (utils/loginAccounts.js EmployeeLogin)
async function loginIdsOf(employee) {
  const ids = employee.userId ? [employee.userId] : [];
  const extra = await prisma.$queryRawUnsafe('SELECT "userId" FROM "EmployeeLogin" WHERE "employeeId" = ?', employee.id).catch(() => []);
  extra.forEach((r) => { if (r.userId && !ids.includes(r.userId)) ids.push(r.userId); });
  return ids;
}

async function state(employee) {
  const c = (await columns(employee.id)) || {};
  const login = employee.userId ? await prisma.user.findUnique({ where: { id: employee.userId }, select: { email: true } }) : null;
  const domains = allowedDomains();
  const local = CP.suggestLocalPart(employee.name);
  return {
    personalEmail: c.personalEmail || null,
    companyEmail: c.companyEmail || null,
    assignedAt: c.companyEmailAt ? new Date(Number(c.companyEmailAt)).toISOString() : null,
    assignedBy: c.companyEmailBy || null,
    loginEmail: login ? login.email : null,
    // an employee from before this feature whose email is already the company one
    workingEmail: employee.email || null,
    suggestion: local && domains.length === 1 ? `${local}@${domains[0]}` : '',
    domains,
    cpanel: { on: CP.configured(), domain: CP.domain() || null },
    generatedPassword: generatedPassword(employee),
  };
}

// why this address cannot be the company email of this person (null = it can)
async function refusal(employee, email, loginIds) {
  if (!LA.looksLikeEmail(email)) return 'Write the full email, like name@company.com.';
  if (/\.invalid$/i.test(email)) return 'That is not a real email address.';
  const domains = allowedDomains();
  if (domains.length) {
    if (!domains.includes(email.split('@')[1])) return `A company email must end with ${domains.map((d) => `@${d}`).join(' or ')}.`;
  } else if (FREE_MAIL.test(email)) return 'That looks like a personal email. Give the company email here.';
  const accounts = await LA.accountsByEmail(email);
  if (accounts.some((u) => !loginIds.includes(u.id))) return 'Another login already uses this email.';
  const others = await prisma.$queryRawUnsafe(
    'SELECT "name", "employeeCode" FROM "Employee" WHERE "id" != ? AND (lower("email") = ? OR lower("companyEmail") = ? OR lower("personalEmail") = ?) LIMIT 1',
    employee.id, email, email, email,
  );
  if (others.length) return `${others[0].name} (${others[0].employeeCode}) already has this email.`;
  const vendor = await prisma.vendorUser.findUnique({ where: { email } }).catch(() => null);
  if (vendor && !vendor.deletedAt) return 'A vendor login already uses this email.';
  return null;
}

async function tickOnboarding(employee) {
  let tasks = [];
  try { tasks = JSON.parse(employee.onboardingTasks || '[]'); } catch { tasks = []; }
  if (!Array.isArray(tasks)) return;
  const row = tasks.find((t) => t && t.task === TASK);
  if (row) row.completed = true; else tasks.push({ task: TASK, completed: true });
  await prisma.employee.update({ where: { id: employee.id }, data: { onboardingTasks: JSON.stringify(tasks) } });
}

// THE FIRST PASSWORD HR GIVES (founder 2026-11-09: "generate click cheyyagaane Teamlink@<joined month> ... Teamlink@082026"):
// Teamlink@ + the month and year of joining, from the date of joining (this month when none is written). Easy to say on a call,
// so TeamLink asks for a new one at the first sign-in (passwordEventData 'admin').
function generatedPassword(employee) {
  const d = employee && employee.dateOfJoining ? new Date(employee.dateOfJoining) : new Date();
  const ist = new Date((Number.isNaN(d.getTime()) ? Date.now() : d.getTime()) + 330 * 60000);
  return `Teamlink@${String(ist.getUTCMonth() + 1).padStart(2, '0')}${ist.getUTCFullYear()}`;
}
const appLink = () => `${require('./passwordReset').baseUrl()}/login`; // eslint-disable-line global-require
const webmailLink = (company) => `https://webmail.${String(company).split('@')[1]}`;

function credentialsMail({ name, company, password }) {
  return [
    `Hello ${String(name || '').split(' ')[0] || ''},`, '',
    'Your sign-in details:', '',
    'TeamLink HRMS (attendance, leave, payslips):', `  Link: ${appLink()}`, `  Email: ${company}`, `  Password: ${password}`, '',
    'Company webmail:', `  Link: ${webmailLink(company)}`, `  Email: ${company}`, `  Password: ${password}`, '',
    'TeamLink asks you for a new password the first time you sign in. Please change the webmail password too, from the webmail settings.',
    'Do not share these details with anyone.', '', '— TeamLink HR',
  ].join('\n');
}

function readyMail({ name, company, personal, mailbox }) {
  const lines = [`Hello ${String(name || '').split(' ')[0] || ''},`, '', `Your company email is ready: ${company}`, '', `From now on, sign in to TeamLink with ${company}. Your password stays the same.`];
  if (mailbox) lines.push('', 'Your mailbox:', `  Email: ${company}`, `  First password: ${mailbox.password}`, `  Webmail: https://webmail.${company.split('@')[1]}`, '', 'Please change this mailbox password the first time you open it.');
  lines.push('', `This address (${personal}) stays on your record for documents and password recovery. If you forget your password, you can use "Forgot password" with either address.`, '', '— TeamLink HR');
  return lines.join('\n');
}

/** -> { status, body } */
async function assign(actor, employeeIn, { email: rawEmail, personalEmail: rawPersonal, createMailbox = false, password = '' } = {}) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeIn.id } });
  if (!employee) return { status: 404, body: { error: 'Employee not found' } };
  if (LEFT.includes(employee.employmentStatus)) return { status: 409, body: { error: 'This person has left. A company email is not given.' } };
  const c = (await columns(employee.id)) || {};
  const loginIds = await loginIdsOf(employee);

  let email = norm(rawEmail);
  if (createMailbox && !email) {
    const local = CP.suggestLocalPart(employee.name);
    email = local && CP.domain() ? `${local}@${CP.domain()}` : '';
  }
  if (!email) return { status: 400, body: { error: 'Write the company email.' } };
  if (createMailbox && !CP.configured()) return { status: 409, body: { error: 'cPanel is not connected on this server. Make the mailbox in cPanel and type the address here.' } };
  // the password HR typed or generated for the new mailbox (empty: a random one, as before)
  const typedPassword = String(password || '');
  if (createMailbox && typedPassword) { const weak = strengthError(typedPassword, { email, name: employee.name }); if (weak) return { status: 400, body: { error: weak } }; }
  if (c.companyEmail && norm(c.companyEmail) === email) return { status: 200, body: { ok: true, unchanged: true, message: 'That is already the company email.' } };

  const personalNow = norm(c.personalEmail) || norm(rawPersonal) || (employee.email && !c.companyEmail ? norm(employee.email) : '');
  if (!personalNow) return { status: 400, body: { error: 'Add the personal email first: the person gets the news there.' } };
  if (personalNow === email) return { status: 400, body: { error: 'The company email must be different from the personal email.' } };
  if (!LA.looksLikeEmail(personalNow)) return { status: 400, body: { error: 'The personal email does not look right.' } };
  const no = await refusal(employee, email, loginIds);
  if (no) return { status: 409, body: { error: no } };

  // the mailbox first: when cPanel says no, nothing here has changed
  let mailbox = null;
  if (createMailbox) {
    const made = await CP.createMailbox({ localPart: email.split('@')[0], ...(typedPassword ? { password: typedPassword } : {}) });
    if (!made.ok) return { status: 502, body: { error: made.error } };
    mailbox = made;
    await logAudit({ userId: actor.id, action: 'Company mailbox created in cPanel', entity: 'Employee', entityId: employee.id, toValue: email });
  }

  const oldLogin = employee.userId ? (await prisma.user.findUnique({ where: { id: employee.userId }, select: { email: true } }) || {}).email : null;
  const now = Date.now();
  await prisma.$transaction([
    ...(loginIds.length ? [prisma.user.updateMany({ where: { id: { in: loginIds } }, data: { email, username: email } })] : []),
    prisma.employee.update({ where: { id: employee.id }, data: { email } }),
    prisma.$executeRawUnsafe(
      'UPDATE "Employee" SET "personalEmail" = ?, "companyEmail" = ?, "companyEmailAt" = ?, "companyEmailBy" = ? WHERE "id" = ?',
      personalNow, email, now, String(actor.name || actor.email || actor.id).slice(0, 120), employee.id,
    ),
  ]);
  // sessions on the old address end; the next sign-in is with the company email
  for (const id of loginIds) await LA.revokeSessions(id); // eslint-disable-line no-await-in-loop
  // HR gave this mailbox: it needs no email code to count as proved
  await prisma.emailVerification.create({ data: { email, purpose: 'employee-self-email', codeHash: 'company-email-assigned', expiresAt: new Date(now), verifiedAt: new Date(now) } }).catch(() => {});
  await tickOnboarding(employee).catch(() => {});

  await logAudit({
    userId: actor.id, action: 'Login email changed', entity: 'User', entityId: employee.userId || employee.id, fromValue: oldLogin || employee.email || '', toValue: email, reason: `Company email assigned by ${actor.name || 'HR'} (${employee.employeeCode})`,
  });

  let mailed = { ok: false, error: 'not tried' };
  try {
    // eslint-disable-next-line global-require
    mailed = await require('./mailer').sendMail({
      to: personalNow, subject: `Your company email is ready: ${email}`, text: readyMail({ name: employee.name, company: email, personal: personalNow, mailbox }), useEmployeeFrom: false, fromName: 'TeamLink HR',
    });
  } catch (e) { mailed = { ok: false, error: e.message }; }
  if (employee.userId) await prisma.notification.create({ data: { userId: employee.userId, title: 'Your company email is ready', message: `Sign in with ${email} from now on.`, channel: 'In-App', recipient: `company-email|${employee.id}|${email}`, status: 'Sent' } }).catch(() => {});
  await logAudit({ userId: actor.id, action: `Company email news: ${mailed && mailed.ok ? 'sent' : 'not sent'}`, entity: 'Employee', entityId: employee.id, toValue: personalNow, reason: mailed && mailed.ok ? null : String((mailed && mailed.error) || '').slice(0, 200) });

  const signedOutSelf = loginIds.includes(actor.id);
  return {
    status: 200,
    body: {
      ok: true, email, personalEmail: personalNow, mailed: !!(mailed && mailed.ok), signedOutSelf,
      // shown once, only when the mail could not carry it
      ...(mailbox && !(mailed && mailed.ok) ? { mailboxPassword: mailbox.password } : {}),
      message: `Saved. ${employee.name} now signs in with ${email}.${mailed && mailed.ok ? ` The news went to ${personalNow}.` : ` The mail to ${personalNow} did not go, so please tell them.`}`,
    },
  };
}

// SEND CREDENTIALS (founder 2026-11-09): the password HR typed or generated becomes the person's TeamLink password AND their webmail
// password (cPanel), and one mail to the personal email carries both links with the sign-in details. The password is never kept:
// TeamLink keeps only its hash, the audit says THAT details were sent, and TeamLink asks for a new password at the first sign-in.
/** -> { status, body } */
async function sendCredentials(actor, employeeIn, { password, to: rawTo } = {}) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeIn.id } });
  if (!employee) return { status: 404, body: { error: 'Employee not found' } };
  if (LEFT.includes(employee.employmentStatus)) return { status: 409, body: { error: 'This person has left.' } };
  const c = (await columns(employee.id)) || {};
  const company = norm(c.companyEmail);
  if (!company) return { status: 409, body: { error: 'Give the company email first.' } };
  const pw = String(password || '');
  const weak = strengthError(pw, { email: company, name: employee.name });
  if (weak) return { status: 400, body: { error: weak } };
  const to = norm(rawTo) || norm(c.personalEmail);
  if (!to || !LA.looksLikeEmail(to)) return { status: 400, body: { error: 'Write the personal email the details go to.' } };
  if (to === company) return { status: 400, body: { error: 'Send the details to their personal email, not to the new mailbox they cannot open yet.' } };
  const user = employee.userId ? await prisma.user.findUnique({ where: { id: employee.userId } }) : null;
  if (!user) return { status: 409, body: { error: 'This person has no TeamLink login yet.' } };
  { const why = require('./roleGuard').checkPasswordTarget({ actor, target: user }); if (why) return { status: 403, body: { error: why } }; } // eslint-disable-line global-require

  // the webmail password first: when cPanel says no, the TeamLink password has not changed either
  const onCpanel = CP.configured() && company.split('@')[1] === CP.domain();
  if (onCpanel) {
    const set = await CP.setMailboxPassword({ email: company, password: pw });
    if (!set.ok) return { status: 502, body: { error: set.error } };
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(pw, 10), ...passwordEventData('admin'), setPasswordTokenHash: null, setPasswordExpiresAt: null } });
  const after = await prisma.user.findUnique({ where: { id: user.id } });
  await require('./passwordReset').afterPasswordChange({ user: after, method: 'admin_reset', byUserId: actor.id, byName: actor.name }).catch(() => {}); // eslint-disable-line global-require

  let mailed = { ok: false, error: 'not tried' };
  try {
    // eslint-disable-next-line global-require
    mailed = await require('./mailer').sendMail({ to, subject: 'Your TeamLink and company email sign-in details', text: credentialsMail({ name: employee.name, company, password: pw }), useEmployeeFrom: false, fromName: 'TeamLink HR' });
  } catch (e) { mailed = { ok: false, error: e.message }; }
  await logAudit({
    userId: actor.id, action: `Sign-in details ${mailed && mailed.ok ? 'sent' : 'set, mail not sent'}`, entity: 'Employee', entityId: employee.id, toValue: to,
    reason: `TeamLink password${onCpanel ? ' and webmail password' : ''} set by ${actor.name || 'HR'}; change required at the next sign-in${mailed && mailed.ok ? '' : ` (mail: ${String((mailed && mailed.error) || '').slice(0, 150)})`}`,
  });
  const both = onCpanel ? 'TeamLink and webmail' : 'TeamLink';
  return {
    status: 200,
    body: {
      ok: true, mailed: !!(mailed && mailed.ok), to, webmail: onCpanel,
      message: mailed && mailed.ok
        ? `Done. The ${both} password is set and the details went to ${to}.${onCpanel ? '' : ' The mailbox is not on cPanel here, so its password was not changed.'}`
        : `The ${both} password is set, but the mail to ${to} did not go. Please give them the details yourself.`,
    },
  };
}

// the employee whose PERSONAL address this is, once their login has moved to the company email
async function movedEmployee(typed) {
  const e = norm(typed);
  if (!e || !LA.looksLikeEmail(e)) return null;
  const rows = await prisma.$queryRawUnsafe('SELECT "id", "userId", "companyEmail", "personalEmail" FROM "Employee" WHERE lower("personalEmail") = ? AND "companyEmail" IS NOT NULL AND "userId" IS NOT NULL LIMIT 1', e).catch(() => []);
  return rows[0] || null;
}

// a right password on the old address: the company email is said; a wrong password gets the same answer as an address nobody has
async function movedLogin(typed, password) {
  const row = await movedEmployee(typed);
  if (!row) return null;
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { passwordHash: true, status: true } });
  if (!user || !user.passwordHash || !(await bcrypt.compare(String(password || ''), user.passwordHash))) return null;
  return row.companyEmail;
}

// "Forgot password" typed with the personal address: the link goes to that address
async function recoveryLogin(typed) {
  const row = await movedEmployee(typed);
  if (!row) return null;
  const [user] = await LA.usersByIds([row.userId]);
  return user ? { user, to: row.personalEmail } : null;
}

// the profile forms send the email back with every save: the same address is fine, another one is refused while a company email is set
async function emailLocked(employeeId, email) {
  if (email === undefined) return null;
  const c = await columns(employeeId).catch(() => null);
  if (!c || !c.companyEmail || norm(email) === norm(c.companyEmail)) return null;
  return `This is the company email and the login. HR changes it under Login & company email on the employee page.`;
}

module.exports = {
  TASK, state, assign, sendCredentials, generatedPassword, movedLogin, recoveryLogin, emailLocked, allowedDomains,
};
