-- NAFA Business OS — DEVELOPMENT-ONLY demo data
--
-- !! Do NOT run this against the production database. !!
-- Every record is prefixed "[DEMO]" so it is obvious and easy to remove (see the clean-up at the bottom).
-- Contains no credentials. Run it in the SQL editor of a development project after the migrations.

with c as (
  insert into public.companies (name, industry, city, website) values
    ('[DEMO] Aurora Motors Pvt Ltd', 'Automotive', 'Mumbai', 'https://aurora-motors.example'),
    ('[DEMO] Bluepeak Beverages', 'FMCG', 'Bengaluru', 'https://bluepeak.example'),
    ('[DEMO] Cedar Realty LLP', 'Real estate', 'Pune', null)
  returning id, name
), ct as (
  insert into public.contacts (company_id, full_name, designation, email, phone)
  select id, v.full_name, v.designation, v.email, v.phone
  from c join (values
    ('[DEMO] Aurora Motors Pvt Ltd', '[DEMO] Asha Mehta', 'Marketing Manager', 'asha@aurora-motors.example', '+919000000001'),
    ('[DEMO] Bluepeak Beverages', '[DEMO] Rohan Iyer', 'Brand Lead', 'rohan@bluepeak.example', '+919000000002'),
    ('[DEMO] Cedar Realty LLP', '[DEMO] Meera Shah', 'Director', 'meera@cedar.example', '+919000000003')
  ) as v(company, full_name, designation, email, phone) on v.company = c.name
  returning id, company_id, full_name
)
insert into public.leads (title, company_id, contact_id, source, service_category, city, status, priority,
                          budget_inr, expected_revenue_inr, event_date, notes)
select v.title, ct.company_id, ct.id, v.source::public.lead_source, v.service::public.service_category, v.city,
       v.status::public.lead_status, v.priority::public.lead_priority, v.budget, v.revenue, v.event_date::date,
       '[DEMO] sample record'
from ct join (values
  ('[DEMO] Asha Mehta',  '[DEMO] Dealer Meet 2027',        'referral', 'corporate_event',    'Mumbai',    'proposal_sent', 'high',   1500000, 300000, '2027-02-15'),
  ('[DEMO] Rohan Iyer',  '[DEMO] Summer Sampling Roadshow', 'website',  'brand_activation',   'Bengaluru', 'qualified',     'medium', 2500000, 450000, '2027-04-10'),
  ('[DEMO] Meera Shah',  '[DEMO] Project Launch Weekend',  'linkedin', 'experiential_marketing', 'Pune',  'new',           'low',     800000, 160000, null)
) as v(contact, title, source, service, city, status, priority, budget, revenue, event_date) on v.contact = ct.full_name;

insert into public.follow_ups (lead_id, title, due_at, type)
select id, '[DEMO] Follow up: ' || title, now() + interval '1 day', 'call' from public.leads where title like '[DEMO]%' limit 2;
insert into public.follow_ups (lead_id, title, due_at, type)
select id, '[DEMO] Overdue check-in: ' || title, now() - interval '2 days', 'whatsapp' from public.leads where title like '[DEMO]%' limit 1;

-- ---------------------------------------------------------------------------
-- Clean-up (run when you want the demo data gone):
--   delete from public.leads     where title like '[DEMO]%';   -- cascades follow-ups and activities
--   delete from public.contacts  where full_name like '[DEMO]%';
--   delete from public.companies where name like '[DEMO]%';
-- ---------------------------------------------------------------------------
