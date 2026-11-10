-- Seed the existing 4th Semester Group B routine from the supplied Class Routine project.
INSERT OR IGNORE INTO teachers(id,name,phone) VALUES
(1,'Umma Salma','01791609120'),
(2,'Monirul Islam Shisir','01718583511'),
(3,'Nadim Mahmud',''),
(4,'Omor Faruk','01737597573'),
(5,'Shehad Ahmed Piash','07144516954'),
(6,'Alamgir Kabir','01719469313'),
(7,'Md. Ariful Hasan','01714517335');
INSERT OR IGNORE INTO rooms(name) VALUES
('1109'),
('1234'),
('2102'),
('2105'),
('2206'),
('2306');
INSERT OR IGNORE INTO subjects(id,group_id,name,code,color) SELECT 1,g.id,'Computer Peripherals & Interfacing','28543','#1D5FA8' FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B';
INSERT OR IGNORE INTO subjects(id,group_id,name,code,color) SELECT 2,g.id,'Data Structure & Algorithm','28542','#2E7D4F' FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B';
INSERT OR IGNORE INTO subjects(id,group_id,name,code,color) SELECT 3,g.id,'Digital Electronics-2','26841','#B8650F' FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B';
INSERT OR IGNORE INTO subjects(id,group_id,name,code,color) SELECT 4,g.id,'Business Communication','25831','#8A3E8A' FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B';
INSERT OR IGNORE INTO subjects(id,group_id,name,code,color) SELECT 5,g.id,'Environmental Studies','29041','#0F7A74' FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B';
INSERT OR IGNORE INTO subjects(id,group_id,name,code,color) SELECT 6,g.id,'Web Design & Development-1','28544','#B3392F' FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B';
INSERT OR IGNORE INTO subjects(id,group_id,name,code,color) SELECT 7,g.id,'Java Programming','28541','#8A6B00' FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B';
INSERT INTO routine_classes(group_id,subject_id,teacher_id,room_id,day_index,start_time,end_time,published) VALUES
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),1,1,(SELECT id FROM rooms WHERE name='2206'),0,'13:30','15:00',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),2,2,(SELECT id FROM rooms WHERE name='2206'),0,'15:00','16:30',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),3,3,(SELECT id FROM rooms WHERE name='2105'),0,'16:30','17:15',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),4,4,(SELECT id FROM rooms WHERE name='2105'),0,'17:15','18:00',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),5,5,(SELECT id FROM rooms WHERE name='2105'),0,'18:00','18:45',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),1,1,(SELECT id FROM rooms WHERE name='2105'),1,'13:30','15:00',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),6,6,(SELECT id FROM rooms WHERE name='2206'),1,'15:00','16:30',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),3,3,(SELECT id FROM rooms WHERE name='2102'),1,'16:30','18:00',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),3,3,(SELECT id FROM rooms WHERE name='2306'),2,'13:30','14:15',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),4,4,(SELECT id FROM rooms WHERE name='2306'),2,'14:15','15:00',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),5,5,(SELECT id FROM rooms WHERE name='1109'),2,'15:00','16:30',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),7,7,(SELECT id FROM rooms WHERE name='2105'),2,'16:30','18:00',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),2,2,(SELECT id FROM rooms WHERE name='2105'),3,'15:00','16:30',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),6,6,(SELECT id FROM rooms WHERE name='2206'),3,'16:30','17:15',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),7,7,(SELECT id FROM rooms WHERE name='2206'),3,'17:15','18:45',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),1,1,(SELECT id FROM rooms WHERE name='1234'),4,'14:15','15:00',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),5,5,(SELECT id FROM rooms WHERE name='1234'),4,'15:00','15:45',1),
((SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name='B'),6,6,(SELECT id FROM rooms WHERE name='2206'),4,'16:30','18:00',1);
UPDATE app_meta SET value=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='last_published_B';
