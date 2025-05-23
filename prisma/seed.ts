import { fakerES_MX as faker } from '@faker-js/faker';
import { PrismaClient, Role, LoanStatus, PaymentMethod, ExpenseCategory, Providers } from '../generated/prisma';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const password = 'admin123';

async function main() {
    console.log('Seeding database...');

    const hashedAdminPassword = await bcrypt.hash(password, 10);

    // Crear propietario admin
    const owner = await prisma.owners.create({
        data: {
            name: 'Administrador',
            username: 'admin',
            passwordHash: hashedAdminPassword,
            roles: [Role.ADMIN],
        },
    });

    // Crear usuarios
    const users = await Promise.all(
        Array.from({ length: 3 }).map(() =>
            prisma.user.create({
                data: {
                    name: faker.person.fullName(),
                    identification: faker.string.alphanumeric(10).toUpperCase(),
                    idIssuedAt: 'Monteria, Cordoba',
                    age: faker.number.int({ min: 18, max: 65 }),
                    phone: faker.phone.number(),
                    address: faker.location.streetAddress(),
                    city: 'Barranquilla',
                    refName: faker.person.fullName(),
                    refID: faker.string.alphanumeric(10).toUpperCase(),
                    refPhone: faker.phone.number(),
                },
            })
        )
    );

    // Crear motocicletas
    const motorcycles = await Promise.all(
        Array.from({ length: 3 }).map(() =>
            prisma.motorcycle.create({
                data: {
                    provider: 'MOTOFACIL',
                    brand: faker.vehicle.manufacturer(),
                    model: faker.vehicle.model(),
                    plate: faker.vehicle.vrm(),
                    color: faker.color.human(),
                    engine: faker.vehicle.vrm(),
                    chassis: faker.vehicle.vin(),
                    cc: faker.number.int({ min: 100, max: 400 }),
                    gps: faker.number.float({ min: -75, max: -70 }),
                },
            })
        )
    );

    const loans = await Promise.all(
        users.map((user, i) => {
            const contractNumber = `C${String(i + 1).padStart(6, '0')}`; // C000001, C000002...
            return prisma.loan.create({
                data: {
                    contractNumber,
                    userId: user.id,
                    motorcycleId: motorcycles[i % motorcycles.length].id,
                    totalAmount: 3000000,
                    downPayment: 500000,
                    installments: 10,
                    paidInstallments: 3,
                    remainingInstallments: 7,
                    totalPaid: 900000,
                    debtRemaining: 2100000,
                    interestRate: 0.05,
                    interestType: 'FIXED',
                    paymentFrequency: 'DAILY',
                    installmentPaymentAmmount: 32000,
                    gpsInstallmentPayment: 2000,
                    status: LoanStatus.ACTIVE,
                },
            });
        })
    );

    // Crear cuotas con createdById
    const installments = await Promise.all(
        loans.flatMap((loan) =>
            Array.from({ length: loan.paidInstallments }).map(() =>
                prisma.installment.create({
                    data: {
                        loanId: loan.id,
                        amount: loan.installmentPaymentAmmount,
                        gps: 2000,
                        paymentMethod: PaymentMethod.CASH,
                        isLate: faker.datatype.boolean(),
                        createdById: owner.id,
                    },
                })
            )
        )
    );

    // Crear cierre de caja con createdById
    const cashRegister = await prisma.cashRegister.create({
        data: {
            provider: Providers.MOTOFACIL,
            cashInRegister: 500000,
            cashFromTransfers: 200000,
            cashFromCards: 100000,
            notes: 'Cierre de caja del día',
            createdById: owner.id,
            payments: {
                connect: installments.map((i) => ({ id: i.id })),
            },
        },
    });

    // Crear egresos con createdById
    await Promise.all(
        Array.from({ length: 3 }).map(() =>
            prisma.expense.create({
                data: {
                    amount: faker.number.float({ min: 50000, max: 300000 }),
                    date: faker.date.recent(),
                    category: ExpenseCategory.SERVICES,
                    paymentMethod: PaymentMethod.CASH,
                    provider: Providers.OBRASOCIAL,
                    beneficiary: faker.company.name(),
                    reference: faker.string.uuid(),
                    description: faker.lorem.sentence(),
                    attachmentUrl: faker.image.url(),
                    cashRegisterId: cashRegister.id,
                    createdById: owner.id,
                },
            })
        )
    );

    console.log('Seeded.');
}

main()
    .catch((e) => {
        console.error('Seeding error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
