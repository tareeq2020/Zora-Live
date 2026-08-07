-- BS47: event.city was freetext until now (see apps/api/src/common/defaults.ts's
-- EVENT_CITIES). Discover's city filter always matched against a fixed id set
-- ('dar', 'zanzibar', 'nairobi', 'accra', 'lagos'), so any freetext value that
-- didn't happen to already be one of those ids silently vanished from its own
-- city page. In production this hid apricot-crush (city = 'Dar Es Salaam')
-- from the Dar es Salaam filter. Normalize known label variants to their
-- canonical id; anything unrecognized is left as-is (the new select-only
-- editor UI + server-side validation stop new drift; a genuinely new city
-- still needs adding to the EVENT_CITIES list before it can be selected).
update event
   set city = 'dar'
 where lower(trim(city)) in ('dar', 'dar es salaam', 'dar-es-salaam', 'dsm');

update event
   set city = 'zanzibar'
 where lower(trim(city)) in ('zanzibar', 'unguja');

update event
   set city = 'nairobi'
 where lower(trim(city)) = 'nairobi';

update event
   set city = 'accra'
 where lower(trim(city)) = 'accra';

update event
   set city = 'lagos'
 where lower(trim(city)) = 'lagos';
