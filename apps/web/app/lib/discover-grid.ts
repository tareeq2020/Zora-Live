/* The events listed in Discover's grid, below the featured card (BS147, BS168).

   The featured event already has the big card at the top, so it is not
   repeated in the grid, except:
   - while the buyer is filtering or searching (every match should list), and
   - when it is the city's only event (an empty grid under it read as
     "nothing here", with a wrong "nothing in All" message). */
export function gridEvents<T extends { i: number }>(list: T[], featIdx: number | null, filtered: boolean): T[] {
  if (filtered || featIdx == null) return list;
  const rest = list.filter(({ i }) => i !== featIdx);
  return rest.length ? rest : list;
}
