import {expect,it} from 'vitest';
import {eventStory} from '../lib/event-story';
it('separates explicit credits and callable enquiry details without assigning invented roles',()=>{
 const result=eventStory('A birthday braai. Bring your appetite. Event enquiries: +233 53 316 3613.','Hosted by Kofi Billz × Ghadi × Shepherd. With Kofi Kay, MP3 and Accra Mayor.','A birthday braai.');
 expect(result.paragraphs).toEqual(['Bring your appetite.']);
 expect(result.contacts).toEqual([{label:'Event enquiries',number:'+233 53 316 3613',href:'tel:+233533163613'}]);
 expect(result.credits).toEqual([{label:'Your hosts',names:['Kofi Billz','Ghadi','Shepherd']},{label:'With',names:['Kofi Kay','MP3','Accra Mayor']}]);
});
it('keeps unknown credit text and rejects malformed phone values',()=>{
 const result=eventStory('Contact: 1234. More news soon.','Line-up to be announced');
 expect(result.contacts).toEqual([]);expect(result.paragraphs.join(' ')).toContain('Contact: 1234');
 expect(result.credits).toEqual([{label:'Line-up',names:['Line-up to be announced']}]);
});
it('preserves prose while making long stories readable and keeps labelled music credits',()=>{
 const note='Bring the whole crew. '.repeat(20);const result=eventStory(note,'Music by Ama & Kojo. Supported by Club House');
 expect(result.paragraphs.length).toBeGreaterThan(1);expect(result.paragraphs.join(' ')).toBe(note.trim());
 expect(result.credits).toEqual([{label:'On the decks',names:['Ama','Kojo']},{label:'With support from',names:['Club House']}]);
});
