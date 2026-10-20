// US / British spelling pairs, matched by stem so inflected forms are caught
// ("neighbours" as well as "neighbour"). `oneWay` pairs are only flagged toward US
// spelling because the British form has a different meaning or use (draught, storey).

export type SpellingGroup = 'ize' | 'yze' | 'our' | 're' | 'll' | 'ce' | 'other';

export interface SpellingPair {
  us: string;
  uk: string;
  group: SpellingGroup;
  oneWay?: boolean;
}

const pairs = (group: SpellingGroup, list: string, oneWay = false): SpellingPair[] =>
  list
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => {
      const [us, uk] = p.split('/');
      return { us, uk, group, oneWay };
    });

export const SPELLING_PAIRS: SpellingPair[] = [
  ...pairs(
    'ize',
    'organiz/organis recogniz/recognis realiz/realis apologiz/apologis prioritiz/prioritis emphasiz/emphasis summariz/summaris minimiz/minimis maximiz/maximis optimiz/optimis utiliz/utilis characteriz/characteris categoriz/categoris standardiz/standardis criticiz/criticis finaliz/finalis authoriz/authoris specializ/specialis fertiliz/fertilis memoriz/memoris visualiz/visualis customiz/customis moderniz/modernis mobiliz/mobilis normaliz/normalis',
  ),
  ...pairs('yze', 'analyz/analys paralyz/paralys catalyz/catalys'),
  ...pairs(
    'our',
    'color/colour favor/favour honor/honour labor/labour neighbor/neighbour behavior/behaviour flavor/flavour humor/humour rumor/rumour harbor/harbour odor/odour vigor/vigour endeavor/endeavour savor/savour',
  ),
  ...pairs('re', 'center/centre liter/litre theater/theatre fiber/fibre somber/sombre'),
  ...pairs('re', 'meter/metre', true),
  ...pairs(
    'll',
    'traveled/travelled traveling/travelling traveler/traveller canceled/cancelled canceling/cancelling labeled/labelled labeling/labelling modeled/modelled modeling/modelling fueled/fuelled fueling/fuelling leveled/levelled marveled/marvelled signaled/signalled totaled/totalled beveled/bevelled shriveled/shrivelled unraveled/unravelled fulfill/fulfil enroll/enrol skillful/skilful installment/instalment',
  ),
  ...pairs('ce', 'defense/defence offense/offence pretense/pretence'),
  ...pairs('ce', 'license/licence', true),
  ...pairs(
    'other',
    'gray/grey mold/mould catalog/catalogue aging/ageing judgment/judgement inquir/enquir plow/plough skeptic/sceptic aluminum/aluminium specialty/speciality sulfur/sulphur jewelry/jewellery pajamas/pyjamas cozy/cosy mustache/moustache anesthe/anaesthe pediatric/paediatric maneuver/manoeuvre',
  ),
  ...pairs('other', 'program/programme story/storey curb/kerb draft/draught tire/tyre practice/practise check/cheque', true),
];

export type SpellingTarget = 'us' | 'uk' | 'oxford';

/** [wrong stem, right stem] pairs to flag for a target spelling. */
export function spellingChecks(target: SpellingTarget): Array<{ wrong: string; right: string }> {
  const out: Array<{ wrong: string; right: string }> = [];
  for (const p of SPELLING_PAIRS) {
    if (target === 'us') out.push({ wrong: p.uk, right: p.us });
    else if (!p.oneWay) {
      // Oxford spelling is British spelling with -ize endings.
      if (target === 'oxford' && p.group === 'ize') out.push({ wrong: p.uk, right: p.us });
      else out.push({ wrong: p.us, right: p.uk });
    }
  }
  return out;
}
