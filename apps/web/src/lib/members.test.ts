import { describe, expect, it } from 'vite-plus/test';
import { parseMemberInput } from './members';

describe('parseMemberInput', () => {
  it('takes a plain name', () => {
    expect(parseMemberInput('  Noa  Levi ')).toEqual({ displayName: 'Noa Levi' });
  });

  it('splits a name and an email', () => {
    expect(parseMemberInput('Noa Noa@Mail.com')).toEqual({ displayName: 'Noa', email: 'noa@mail.com' });
  });

  it('splits a name and a local phone into E.164', () => {
    expect(parseMemberInput('נועה 050-123-4567')).toEqual({ displayName: 'נועה', phone: '+972501234567' });
  });

  it('names a contact-only entry after the contact', () => {
    expect(parseMemberInput('itay@mail.com')).toEqual({ displayName: 'itay', email: 'itay@mail.com' });
    expect(parseMemberInput('+972501234567')).toEqual({ displayName: '+972501234567', phone: '+972501234567' });
  });

  it('keeps digits inside a name', () => {
    expect(parseMemberInput('Room 12')).toEqual({ displayName: 'Room 12' });
  });

  it('rejects empty input and caps the name length', () => {
    expect(parseMemberInput('   ')).toBeNull();
    expect(parseMemberInput('x'.repeat(100))?.displayName).toHaveLength(60);
  });
});
