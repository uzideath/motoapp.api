import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { CreateLoanDto, UpdateLoanDto } from './loan.dto';


@Injectable()
export class LoanService {
    constructor(private readonly prisma: PrismaService) { }

    async create(dto: CreateLoanDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: dto.userId },
        });
        if (!user) throw new NotFoundException('User does not exist');
        const motorcycle = await this.prisma.motorcycle.findUnique({
            where: { id: dto.motorcycleId },
        });
        if (!motorcycle) throw new NotFoundException('Motorcycle does not exist');
        return this.prisma.loan.create({
            data: {
                ...dto,
                paidInstallments: 0,
                remainingInstallments: dto.installments,
                totalPaid: 0,
                debtRemaining: dto.totalAmount,
            },
        });
    }


    async findAll() {
        return this.prisma.loan.findMany({
            include: {
                user: true,
                motorcycle: true,
                payments: true,
            },
        });
    }

    async findOne(id: string) {
        const loan = await this.prisma.loan.findUnique({
            where: { id },
            include: {
                user: true,
                motorcycle: true,
                payments: true,
            },
        });

        if (!loan) throw new NotFoundException('Loan not found');
        return loan;
    }

    async update(id: string, dto: UpdateLoanDto) {
        await this.findOne(id);

        return this.prisma.loan.update({
            where: { id },
            data: dto,
        });
    }

    async remove(id: string) {
        await this.findOne(id);

        return this.prisma.loan.delete({
            where: { id },
        });
    }
}
