/**
 * @fileoverview Canonical technology combinations and speed pairs for the June 2021 FCC Area Table.
 * @module services/open-data/area-filters
 */

/** Every nonempty alphabetical combination of the Area Table's six technology letters. */
export const AREA_TECH_FILTERS = [
  'a',
  'ac',
  'acf',
  'acfo',
  'acfos',
  'acfosw',
  'acfow',
  'acfs',
  'acfsw',
  'acfw',
  'aco',
  'acos',
  'acosw',
  'acow',
  'acs',
  'acsw',
  'acw',
  'af',
  'afo',
  'afos',
  'afosw',
  'afow',
  'afs',
  'afsw',
  'afw',
  'ao',
  'aos',
  'aosw',
  'aow',
  'as',
  'asw',
  'aw',
  'c',
  'cf',
  'cfo',
  'cfos',
  'cfosw',
  'cfow',
  'cfs',
  'cfsw',
  'cfw',
  'co',
  'cos',
  'cosw',
  'cow',
  'cs',
  'csw',
  'cw',
  'f',
  'fo',
  'fos',
  'fosw',
  'fow',
  'fs',
  'fsw',
  'fw',
  'o',
  'os',
  'osw',
  'ow',
  's',
  'sw',
  'w',
] as const;

/** Technology definitions from the FCC Area Table metadata, distinct from deployment technology codes. */
export const AREA_TECH_DESCRIPTION =
  'Any nonempty alphabetical combination of a=ADSL/DSL, c=cable, f=fiber, o=other (symmetric DSL, other copper, power line), s=satellite, w=fixed wireless. Default acfow excludes satellite; explicit acfosw includes every technology. acfow includes all fixed wireless and is not an exact program-technology eligibility filter.';

/** Speed is keyed by download Mbps; the FCC metadata defines each corresponding upload threshold. */
export const AREA_SPEED_DESCRIPTION =
  'Download key for a download/upload threshold pair in Mbps: 0.2=0.2/0.2, 4=4/1, 10=10/1, 25=25/3, 100=100/10, 250=250/25, 1000=1000/100. These historical population aggregates cannot establish current BEAD eligibility or address service; 100/10 does not establish 100/20 availability.';
