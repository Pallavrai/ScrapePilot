import {it,expect} from 'vitest';
import {publicationIssues} from '../packages/contracts/src/publishing';
import {emptyDefinition} from '../packages/contracts/src/index';
import {robotsConflict} from '../packages/scraper-engine/src/network';
it('blocks secrets stored as ordinary template defaults',()=>{const d=emptyDefinition();d.inputs.password={type:'text',required:true,default:'private'};expect(publicationIssues(d)).not.toHaveLength(0)});
it('accepts secret references without copying their values',()=>{const d=emptyDefinition();d.inputs.password={type:'secretRef',required:true};expect(publicationIssues(d)).toHaveLength(0)});
it('surfaces wildcard robots disallow-all',()=>expect(robotsConflict('User-agent: *\nDisallow: /')).toBe(true));
it('does not confuse another crawler with this one',()=>expect(robotsConflict('User-agent: OtherBot\nDisallow: /\nUser-agent: *\nAllow: /')).toBe(false));
