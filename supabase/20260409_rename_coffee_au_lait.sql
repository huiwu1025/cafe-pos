begin;

update public.products
set name = '日式咖啡歐蕾'
where name = '咖啡歐蕾';

commit;
